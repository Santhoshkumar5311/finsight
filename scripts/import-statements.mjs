// Offline import: the API must be stopped to avoid concurrent encrypted-store writes.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import '../services/api/src/config.js';
import { live } from '../services/api/src/config.js';
import { localStore } from '../services/api/src/local-store.js';
import { parseIciciDocument } from '../services/api/src/providers/document-import.js';
import { DEMO_USER } from '../services/api/src/security.js';
import * as repo from '../services/api/src/repository.js';
import { makeBudgets } from '../packages/core/src/index.js';
if (live) throw new Error('Use the authenticated upload route in live mode');
if (!process.env.DEMO_DATA_FILE)
  throw new Error('Set DEMO_DATA_FILE to a private local workspace first');
if (!/^[a-f0-9]{64}$/i.test(process.env.PII_TOKEN_KEY || ''))
  throw new Error('Configure a random PII_TOKEN_KEY before importing personal data');
const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: npm run import:statements -- file.pdf file.xls');
await new Promise((ok, fail) => {
  const socket = createConnection({ host: '127.0.0.1', port: Number(process.env.PORT || 4000) });
  socket.once('connect', () => {
    socket.destroy();
    fail(new Error('Stop the FinSight API before offline import'));
  });
  socket.once('error', (error) => (error.code === 'ECONNREFUSED' ? ok() : fail(error)));
});
const parsed = [];
for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Statement exceeds 10 MB');
  parsed.push(await parseIciciDocument(bytes, DEMO_USER));
}
parsed.sort((a, b) => a.balanceDate.localeCompare(b.balanceDate));
const target = resolve(process.env.DEMO_DATA_FILE);
try {
  await access(target);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const store = await localStore(target);
  await store.write({
    accounts: [],
    transactions: [],
    bills: [],
    budgets: [],
    diaries: [],
    preferences: { leadHours: [72, 24, 1], notifications: false },
    subscriptions: [],
    deliveries: [],
    metrics: null,
  });
}
await repo.initStore();
const before = await repo.state(DEMO_USER);
for (const document of parsed) {
  await repo.importTransactions(
    DEMO_USER,
    {
      accountId: document.accountId,
      accountName:
        document.accountType === 'credit' ? 'ICICI credit card' : 'ICICI savings account',
      institution: 'ICICI Bank',
      accountType: document.accountType,
      maskedNumber: document.last4,
      currentBalance: document.closingBalance,
      balanceDate: document.balanceDate,
      currency: 'INR',
      provider: 'icici-statement',
    },
    document.transactions,
  );
}
const after = await repo.state(DEMO_USER);
if (!after.budgets.length) await repo.saveBudgets(DEMO_USER, makeBudgets(after.transactions));
console.log(
  JSON.stringify({
    files: parsed.length,
    reconciled: parsed.every((p) => p.reconciled),
    rowsRead: parsed.reduce((n, p) => n + p.rowCount, 0),
    newTransactions: after.transactions.length - before.transactions.length,
    totalTransactions: after.transactions.length,
    accounts: after.accounts.length,
  }),
);
