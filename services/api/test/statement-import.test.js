import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIciciStatement, StatementImportError } from '../src/providers/statement-import.js';

const header =
  'Tran Date,Chq No,Particulars,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )';
const validCsv = [
  header,
  '01/09/2026,,UPI-SWIGGY-500123456789-swiggy@icici,450.00,,49550.00',
  '03/09/2026,,NEFT SALARY CREDIT ACME INDIA PVT LTD,,85000.00,134550.00',
  '05/09/2026,,"BIGBASKET, ONLINE ORDER",3200.00,,131350.00',
].join('\n');

test('parses a valid ICICI statement into debit/credit-normalized transactions', () => {
  const { transactions, rowCount, skipped, closingBalance } = parseIciciStatement(validCsv, 'acc1');
  assert.equal(rowCount, 3);
  assert.equal(skipped, 0);
  assert.equal(closingBalance, 13135000);
  const swiggy = transactions.find((t) => t.description.includes('SWIGGY'));
  assert.equal(swiggy.amount, 45000); // debit -> positive outflow, in paise
  assert.equal(swiggy.currency, 'INR');
  assert.equal(swiggy.provider, 'icici-statement');
  assert.equal(swiggy.accountId, 'acc1');
  const salary = transactions.find((t) => t.description.includes('SALARY'));
  assert.equal(salary.amount, -8500000); // credit -> negative inflow
  // A quoted field containing a comma is parsed as one column, not split.
  const groceries = transactions.find((t) => t.description.includes('BIGBASKET'));
  assert.equal(groceries.description, 'BIGBASKET, ONLINE ORDER');
});

test('rejects a file with no recognizable ICICI statement columns', () => {
  const csv = 'Foo,Bar\n1,2';
  assert.throws(() => parseIciciStatement(csv, 'acc1'), StatementImportError);
});

test('rejects an empty file', () => {
  assert.throws(() => parseIciciStatement('', 'acc1'), StatementImportError);
});

test('skips rows with an unparseable date or an empty description instead of importing garbage', () => {
  const csv = [
    header,
    'not-a-date,,Coffee shop,100.00,,0',
    '02/09/2026,,,50.00,,0',
    '03/09/2026,,Valid row,75.00,,49925.00',
  ].join('\n');
  const { transactions, rowCount, skipped, warnings } = parseIciciStatement(csv, 'acc1');
  assert.equal(rowCount, 1);
  assert.equal(skipped, 2);
  assert.equal(transactions[0].description, 'Valid row');
  assert.equal(warnings.length, 2);
});

test('skips a row with both a withdrawal and a deposit amount as ambiguous', () => {
  const csv = [header, '01/09/2026,,Ambiguous row,100.00,50.00,0'].join('\n');
  assert.throws(() => parseIciciStatement(csv, 'acc1'), /No usable transaction rows/);
});

test('re-parsing the same statement produces identical transaction ids for safe re-upload', () => {
  const first = parseIciciStatement(validCsv, 'acc1');
  const second = parseIciciStatement(validCsv, 'acc1');
  assert.deepEqual(
    first.transactions.map((t) => t.transactionId),
    second.transactions.map((t) => t.transactionId),
  );
});

test('two distinct same-day transactions with identical amount/description get distinct ids', () => {
  const csv = [
    header,
    '01/09/2026,,UPI-COFFEE-1,100.00,,0',
    '01/09/2026,,UPI-COFFEE-1,100.00,,0',
  ].join('\n');
  const { transactions } = parseIciciStatement(csv, 'acc1');
  assert.equal(transactions.length, 2);
  assert.notEqual(transactions[0].transactionId, transactions[1].transactionId);
});

test('accepts an alternate ISO date format', () => {
  const csv = [header, '2026-09-01,,Coffee,100.00,,0'].join('\n');
  const { transactions } = parseIciciStatement(csv, 'acc1');
  assert.equal(transactions[0].date, '2026-09-01');
});

test('tokenizes a UPI reference from narration instead of persisting its identifier', () => {
  const { transactions } = parseIciciStatement(validCsv, 'acc1');
  const swiggy = transactions.find((t) => t.description.includes('SWIGGY'));
  assert.notEqual(swiggy.reference, '500123456789');
  assert.match(swiggy.reference, /^[a-f0-9]{64}$/);
});

test('CSV preserves overdrafts, accepts zero balances and chooses newest balance', () => {
  const csv = [
    header,
    '03/09/2026,,CC BillPay TEST,100.00,,-50.00',
    '01/09/2026,,Store,50.00,,0',
  ].join('\n');
  const result = parseIciciStatement(csv, 'acc');
  assert.equal(result.closingBalance, -5000);
  assert.equal(result.balanceDate, '2026-09-03');
  assert.equal(result.transactions[0].transfer, true);
});
test('CSV rejects impossible calendar dates instead of rolling into another month', () => {
  assert.throws(
    () => parseIciciStatement([header, '31/02/2026,,Store,10.00,,0'].join('\n'), 'acc'),
    /No usable/,
  );
});
