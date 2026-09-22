import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'finsight-documents-'));
process.env.APP_MODE = 'demo';
process.env.DEMO_DATA_FILE = join(directory, 'store.json');
const { parseIciciDocument } = await import('../src/providers/document-import.js');
const repo = await import('../src/repository.js');
const user = '00000000-0000-4000-8000-000000000001';
const fixture = await readFile(new URL('./fixtures/synthetic-card.pdf', import.meta.url));
test('PDF parser reconciles controls, tokenizes identities and keeps repeat imports stable', async () => {
  const first = await parseIciciDocument(fixture, user);
  const second = await parseIciciDocument(fixture, user);
  assert.deepEqual(first, second);
  assert.equal(first.reconciled, true);
  assert.equal(first.rowCount, 2);
  assert.equal(first.closingBalance, 10000);
  assert.equal(first.balanceDate, '2026-09-15');
  assert.equal(first.transactions[1].amount, -2000);
  assert.equal(first.transactions[1].transfer, true);
  assert.match(first.accountId, /^[a-f0-9]{64}$/);
  assert.notEqual(first.transactions[0].reference, 'TEST001');
  const anotherOwner = await parseIciciDocument(fixture, 'another-owner');
  assert.notEqual(anotherOwner.accountId, first.accountId);
});
test('PDF totals mismatch rejects the entire statement', async () => {
  const invalid = await readFile(new URL('./fixtures/synthetic-card-invalid.pdf', import.meta.url));
  await assert.rejects(parseIciciDocument(invalid, user), /do not match/);
});
test('non-document input is rejected without execution', async () => {
  await assert.rejects(
    parseIciciDocument(Buffer.from('print("do not execute")'), user),
    /Unsupported/,
  );
});
test('reimport upserts records and older statements preserve the latest balance', async () => {
  const parsed = await parseIciciDocument(fixture, user);
  await repo.initStore();
  const metadata = {
    accountId: parsed.accountId,
    accountName: 'Synthetic card',
    accountType: 'credit',
    maskedNumber: '2222',
    currentBalance: 10000,
    balanceDate: '2026-09-15',
    currency: 'INR',
    provider: 'icici-statement',
  };
  await repo.importTransactions(user, metadata, parsed.transactions);
  const before = await repo.state(user);
  await repo.importTransactions(
    user,
    { ...metadata, balanceDate: '2026-08-15', currentBalance: 500 },
    parsed.transactions,
  );
  const after = await repo.state(user);
  assert.equal(after.transactions.length, before.transactions.length);
  const card = after.accounts.find((a) => a.id === parsed.accountId);
  assert.equal(card.balance, 10000);
  assert.equal(card.balanceAsOf, '2026-09-15');
});
test.after(async () => rm(directory, { recursive: true, force: true }));
