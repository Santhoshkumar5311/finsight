import { tokenise } from '../security.js';

/**
 * Parses ICICI Bank's savings-account "Account Statement" CSV export (Tran Date /
 * Value Date, Chq No, Particulars/Transaction Remarks, Withdrawal Amount, Deposit
 * Amount, Balance — the standard NetBanking statement download) into
 * NormalizedTransaction rows (see providers/types.js). This is the practical way to
 * use FinSight with real INR transactions before any live Account Aggregator
 * connection exists; it needs no credentials and no external service.
 *
 * A different ICICI account type (credit card, NRI, etc.) may export different
 * column headers; this parser only recognizes the aliases below and fails with a
 * clear error rather than guessing at an unrecognized layout.
 */
const HEADER_ALIASES = {
  date: ['transaction date', 'tran date', 'value date', 'date'],
  description: ['transaction remarks', 'particulars', 'narration', 'description'],
  debit: [
    'withdrawal amount (inr )',
    'withdrawal amount (inr)',
    'withdrawal amount',
    'debit amount',
    'debit',
  ],
  credit: [
    'deposit amount (inr )',
    'deposit amount (inr)',
    'deposit amount',
    'credit amount',
    'credit',
  ],
  balance: ['balance (inr )', 'balance (inr)', 'balance', 'closing balance'],
  reference: ['cheque number', 'chq./ref.no.', 'chq/ref no', 'reference number', 'ref no'],
};
const MAX_ROWS = 20000;

export class StatementImportError extends Error {}

function parseCsv(text) {
  // Handles quoted fields (with embedded commas/newlines/escaped "") the way Excel/ICICI export them.
  const rows = [];
  let row = [],
    field = '',
    inQuotes = false;
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchColumns(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const columns = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index !== -1) columns[field] = index;
  }
  if (
    columns.date == null ||
    columns.description == null ||
    (columns.debit == null && columns.credit == null)
  )
    throw new StatementImportError(
      'Unrecognized ICICI statement format. Expected columns for a date, a description ' +
        '(Transaction Remarks/Particulars), and Withdrawal/Deposit amounts. Found headers: ' +
        headerRow.join(', '),
    );
  return columns;
}

function parseAmount(raw, signed = false) {
  if (raw == null) return null;
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && Number.isSafeInteger(Math.round(n * 100)) && (signed || n > 0)
    ? n
    : null;
}

function validDate(value) {
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function parseDate(raw) {
  const s = (raw || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validDate(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    if (Number(mo) > 12) return null; // ambiguous/invalid, don't guess
    return validDate(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  return null;
}

/**
 * @param {string} csvText
 * @param {string} accountId - tokenised account id these transactions belong to
 * @returns {{ transactions: import('./types.js').NormalizedTransaction[], rowCount: number, skipped: number, warnings: string[], closingBalance: number|null }}
 */
export function parseIciciStatement(csvText, accountId) {
  if (!csvText || !csvText.trim()) throw new StatementImportError('Empty statement file');
  const rows = parseCsv(csvText);
  if (!rows.length) throw new StatementImportError('No rows found in statement file');
  if (rows.length - 1 > MAX_ROWS)
    throw new StatementImportError(`Statement has too many rows (max ${MAX_ROWS})`);
  const columns = matchColumns(rows[0]);
  const occurrences = new Map();
  const transactions = [];
  const warnings = [];
  let skipped = 0;
  let closingBalance = null,
    balanceDate = null;
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const rawDate = cells[columns.date],
      description = (cells[columns.description] || '').trim();
    const date = parseDate(rawDate);
    const debit = columns.debit != null ? parseAmount(cells[columns.debit]) : null;
    const credit = columns.credit != null ? parseAmount(cells[columns.credit]) : null;
    const balance = columns.balance != null ? parseAmount(cells[columns.balance], true) : null;
    if (
      !date ||
      !description ||
      (debit == null && credit == null) ||
      (debit != null && credit != null)
    ) {
      skipped++;
      warnings.push(`Row ${i + 1}: skipped (unparseable date/description or ambiguous amount)`);
      continue;
    }
    const amount = debit != null ? debit : credit;
    const direction = debit != null ? 'debit' : 'credit';
    const key = `${date}|${description}|${amount}|${direction}`;
    const index = occurrences.get(key) || 0;
    occurrences.set(key, index + 1);
    const reference =
      columns.reference != null && cells[columns.reference]?.trim()
        ? cells[columns.reference].trim()
        : /UPI[/-]/i.test(description)
          ? description.split(/[/-]/).find((p) => /^\d{6,}$/.test(p))
          : undefined;
    transactions.push({
      provider: 'icici-statement',
      transactionId: tokenise(`icici-statement:${accountId}:${key}:${index}`),
      accountId,
      date,
      description,
      amount: direction === 'debit' ? Math.round(amount * 100) : -Math.round(amount * 100),
      currency: 'INR',
      pending: false,
      status: 'posted',
      reference: reference ? tokenise(reference) : undefined,
      transfer: /credit.?card|cc\s*pay|cc\s*bill\s*pay|ccbill|billpay.*card/i.test(description),
    });
    if (balance != null && (!balanceDate || date >= balanceDate)) {
      closingBalance = Math.round(balance * 100);
      balanceDate = date;
    }
  }
  if (!transactions.length)
    throw new StatementImportError(
      `No usable transaction rows found (${skipped} row(s) skipped). Check the file matches an ICICI savings account statement export.`,
    );
  return {
    transactions,
    rowCount: transactions.length,
    skipped,
    warnings,
    closingBalance,
    balanceDate,
  };
}
