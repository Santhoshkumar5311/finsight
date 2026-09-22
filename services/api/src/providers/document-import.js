import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { tokenise } from '../security.js';
import { StatementImportError } from './statement-import.js';
const script = fileURLToPath(new URL('../../python/read_statement.py', import.meta.url));
const bundled = fileURLToPath(new URL('../../../../.data/import-venv/bin/python', import.meta.url));
const rowSchema = z.object({
  date: z.iso.date(),
  description: z.string().min(1).max(2000),
  amount: z.number().int().min(-100000000000).max(100000000000),
  reference: z.string().max(300),
  transfer: z.boolean(),
  balance: z.number().int().nullable().optional(),
});
const resultSchema = z.object({
  kind: z.enum(['credit', 'depository']),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  last4: z.string().regex(/^\d{4}$/),
  balance: z.number().int(),
  balanceDate: z.iso.date(),
  transactions: z.array(rowSchema).min(1).max(20000),
  reconciled: z.literal(true),
});
async function parseDocument(buffer, user) {
  let python = process.env.STATEMENT_PYTHON;
  if (!python) {
    try {
      await access(bundled);
      python = bundled;
    } catch {
      python = 'python3';
    }
  }
  const output = await new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
    });
    const chunks = [];
    let size = 0,
      errorText = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new StatementImportError('Statement parsing timed out; use a smaller statement'));
    }, 20000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new StatementImportError('Statement contains too much data'));
      } else chunks.push(chunk);
    });
    child.stderr.on('data', () => {
      errorText = 'Parser runtime unavailable';
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(
        new StatementImportError(
          'Install the statement parser dependencies with npm run setup:imports',
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (code !== 0) reject(new StatementImportError(data.error || errorText));
        else resolve(data);
      } catch {
        reject(
          new StatementImportError(
            'Statement parser is unavailable. Run npm run setup:imports with Python 3.10 or later.',
          ),
        );
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
  const parsed = resultSchema.parse(output);
  const accountId = tokenise(`icici-document:${user}:${parsed.fingerprint}`);
  const seen = new Map();
  const transactions = parsed.transactions.map((t) => {
    // Card serials identify genuine repeat purchases across overlapping PDF periods.
    // Workbook balances disambiguate repeated same-day amounts without row-position IDs.
    const base = t.reference
      ? `ref:${t.reference}:${t.date}:${t.amount}`
      : `${t.date}:${t.description}:${t.amount}:${t.balance ?? ''}`;
    const occurrence = seen.get(base) || 0;
    seen.set(base, occurrence + 1);
    return {
      provider: 'icici-statement',
      transactionId: tokenise(`${accountId}:${base}:${occurrence}`),
      accountId,
      date: t.date,
      description: t.description,
      amount: t.amount,
      currency: 'INR',
      pending: false,
      status: 'posted',
      transfer: t.transfer,
      reference: t.reference ? tokenise(t.reference) : undefined,
    };
  });
  return {
    accountId,
    accountType: parsed.kind,
    last4: parsed.last4,
    balanceDate: parsed.balanceDate,
    closingBalance: parsed.balance,
    transactions,
    rowCount: transactions.length,
    skipped: 0,
    warnings: [],
    reconciled: true,
  };
}

let activeParsers = 0;
export async function parseIciciDocument(buffer, user) {
  if (buffer.length > 10 * 1024 * 1024) throw new StatementImportError('File exceeds 10 MB');
  if (activeParsers >= 2) throw new StatementImportError('Statement parser is busy; retry shortly');
  activeParsers++;
  try {
    return await parseDocument(buffer, user);
  } finally {
    activeParsers--;
  }
}
