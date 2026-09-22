import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  categorize,
  salaries,
  recurringBills,
  anomalies,
  makeBudgets,
  money,
  currenciesPresent,
  primaryCurrency,
} from '../../../packages/core/src/index.js';
const tx = (overrides = {}) => ({
  id: '1',
  name: 'Coffee',
  date: '2026-09-16',
  amount: 500,
  category: 'Dining',
  pending: false,
  currency: 'USD',
  ...overrides,
});
const state = (transactions = [], accounts = []) => ({ transactions, accounts, bills: [] });
test('profit subtracts expenses and positive credit liabilities using integer cents', () => {
  const result = summarize(
    state(
      [tx({ amount: -500000, name: 'PAYROLL' }), tx({ amount: 125050 })],
      [
        { type: 'credit', balance: 40000, currency: 'USD' },
        { type: 'depository', balance: -1000, currency: 'USD' },
        { type: 'depository', balance: 100000, currency: 'USD' },
      ],
    ),
    { month: '2026-09' },
  );
  assert.equal(result.profit, 333950);
  assert.equal(result.debt, 41000);
});
test('credit overpayments are not debt, transfers and pending transactions do not inflate totals', () => {
  const result = summarize(
    state(
      [
        tx({ amount: -100000, transfer: true }),
        tx({ amount: 5000, pending: true }),
        tx({ amount: 1000 }),
      ],
      [{ type: 'credit', balance: -5000, currency: 'USD' }],
    ),
    { month: '2026-09' },
  );
  assert.equal(result.income, 0);
  assert.equal(result.expenses, 1000);
  assert.equal(result.debt, 0);
});
test('week includes exactly seven UTC days', () => {
  const result = summarize(
    state([
      tx({ date: '2026-09-09' }),
      tx({ date: '2026-09-10' }),
      tx({ date: '2026-09-16' }),
      tx({ date: '2026-09-17' }),
    ]),
    { period: 'week', now: new Date('2026-09-16T15:00:00Z') },
  );
  assert.equal(result.expenses, 1000);
});
test('salary patterns require credits and consistent recurrence', () => {
  assert.equal(salaries([tx({ name: 'DIRECT DEP', amount: -250000 })]).length, 1);
  assert.equal(salaries([tx({ name: 'PAYROLL', amount: 250000 })]).length, 0);
  assert.equal(
    salaries([
      tx({ id: 'a', name: 'Employer', amount: -200000, date: '2026-08-15' }),
      tx({ id: 'b', name: 'Employer', amount: -202000, date: '2026-09-15' }),
    ]).length,
    2,
  );
});
test('monthly recurring bills clamp January 31 to February 28', () => {
  const bills = recurringBills(
    [
      tx({ id: 'a', name: 'Rent', date: '2025-12-31' }),
      tx({ id: 'b', name: 'Rent', date: '2026-01-31' }),
    ],
    new Date('2026-02-01'),
  );
  assert.equal(bills[0].due, '2026-02-28');
});
test('paid bills reconcile with matching posted payment, not a pending charge', () => {
  const s = state([tx({ name: 'Internet', date: '2026-09-15', amount: 7000 })]);
  s.bills = [{ id: 'b', name: 'Internet', amount: 7000, due: '2026-09-16' }];
  assert.equal(summarize(s, { now: new Date('2026-09-16') }).bills[0].status, 'paid');
  s.transactions[0].pending = true;
  assert.equal(summarize(s, { now: new Date('2026-09-16') }).bills[0].status, 'upcoming');
});
test('duplicate charges are flagged but pending-to-posted is not a duplicate', () => {
  assert.equal(anomalies([tx({ id: 'a' }), tx({ id: 'b' })]).length, 1);
  assert.equal(anomalies([tx({ id: 'a' }), tx({ id: 'b', pending: true })]).length, 0);
});
test('subscription price spike compares against the previous charge', () => {
  const alerts = anomalies([
    tx({ id: 'a', name: 'Netflix', category: 'Subscriptions', date: '2026-08-10', amount: 1000 }),
    tx({ id: 'b', name: 'Netflix', category: 'Subscriptions', date: '2026-09-10', amount: 1599 }),
  ]);
  assert.equal(alerts[0].type, 'price-spike');
});
test('generated budgets use complete historical months and exclude transfers', () => {
  const budgets = makeBudgets(
    [
      tx({ date: '2026-08-01', amount: 9000 }),
      tx({ date: '2026-07-01', amount: 11000 }),
      tx({ date: '2026-09-01', amount: 50000 }),
      tx({ date: '2026-08-01', amount: 100000, transfer: true }),
    ],
    new Date('2026-09-16'),
  );
  assert.equal(budgets.find((b) => b.category === 'Dining').limit, 10000);
});
test('categories map merchant descriptions to requested vocabulary', () => {
  assert.equal(categorize('Whole Foods Market'), 'Groceries');
  assert.equal(categorize('Spotify Premium'), 'Subscriptions');
  assert.equal(categorize('Unrecognized merchant'), 'Other');
});
test('sample payroll is an inflow and produces a positive surplus', async () => {
  const { seed } = await import('../src/seed.js');
  const s = seed();
  assert.ok(s.transactions.filter((t) => /PAYROLL/.test(t.name)).every((t) => t.amount < 0));
  assert.ok(summarize(s).income > 0);
});

test('money formats INR with the Indian locale and USD with the US locale', () => {
  assert.equal(money(150000, 'INR'), '₹1,500.00');
  assert.equal(money(150000, 'USD'), '$1,500.00');
  assert.equal(money(150000), '$1,500.00');
});
test('currenciesPresent and primaryCurrency read from accounts and transactions', () => {
  const s = state([tx({ currency: 'INR' })], [{ type: 'depository', balance: 0, currency: 'INR' }]);
  assert.deepEqual(currenciesPresent(s), ['INR']);
  assert.equal(primaryCurrency(s), 'INR');
  assert.equal(primaryCurrency(state([], [])), 'USD');
});
test('summarize never blends two currencies into one total', () => {
  const s = state(
    [
      tx({ id: 'usd', amount: 1000, currency: 'USD' }),
      tx({ id: 'inr', amount: 500000, currency: 'INR' }),
    ],
    [
      { type: 'depository', balance: 100000, currency: 'USD' },
      { type: 'depository', balance: 2000000, currency: 'INR' },
    ],
  );
  const usd = summarize(s, { month: '2026-09', currency: 'USD' });
  const inr = summarize(s, { month: '2026-09', currency: 'INR' });
  assert.equal(usd.expenses, 1000);
  assert.equal(inr.expenses, 500000);
  assert.equal(usd.currency, 'USD');
  assert.equal(inr.currency, 'INR');
  // Defaulting with no currency option picks the first currency present, not a blend of both.
  assert.equal(summarize(s, { month: '2026-09' }).expenses, 1000);
});
test('categories recognize common Indian merchant/UPI narrations', () => {
  assert.equal(categorize('UPI-SWIGGY-500123456789-swiggy@icici'), 'Dining');
  assert.equal(categorize('BIGBASKET ONLINE'), 'Groceries');
  assert.equal(categorize('ELECTRICITY BOARD PAYMENT'), 'Utilities');
});
test('next-month forecast uses historical income and accounts for known bills', async () => {
  const { forecastNextMonth } = await import('../../../packages/core/src/index.js');
  const s = state(
    [
      tx({ date: '2026-08-01', amount: -500000 }),
      tx({ date: '2026-08-02', amount: 100000, category: 'Utilities' }),
      tx({ date: '2026-08-03', amount: 20000 }),
    ],
    [{ type: 'credit', balance: 50000, currency: 'USD' }],
  );
  s.bills = [{ id: 'b', name: 'Rent', amount: 150000, due: '2026-10-01' }];
  const f = forecastNextMonth(s, new Date('2026-09-16'));
  assert.equal(f.income, 500000);
  assert.equal(f.expenses, 170000);
  assert.equal(f.profit, 280000);
});

test('card refunds reduce expenses and card repayments are excluded from income', () => {
  const state = {
    accounts: [{ id: 'card', type: 'credit', currency: 'INR', balance: 8000 }],
    transactions: [
      {
        id: 'purchase',
        name: 'Store',
        accountId: 'card',
        date: '2026-09-10',
        amount: 10000,
        category: 'Shopping',
        currency: 'INR',
      },
      {
        id: 'refund',
        name: 'Store refund',
        accountId: 'card',
        date: '2026-09-11',
        amount: -2000,
        category: 'Shopping',
        currency: 'INR',
      },
      {
        id: 'payment',
        name: 'Payment received',
        accountId: 'card',
        date: '2026-09-12',
        amount: -5000,
        category: 'Other',
        transfer: true,
        currency: 'INR',
      },
    ],
    bills: [],
    budgets: [],
  };
  const summary = summarize(state, { month: '2026-09', currency: 'INR' });
  assert.equal(summary.income, 0);
  assert.equal(summary.expenses, 8000);
  assert.equal(summary.spending[0].amount, 8000);
});

test('recurring card repayments are excluded from bill detection', () => {
  const transfers = ['2026-07-10', '2026-08-10', '2026-09-10'].map((date, i) =>
    tx({ id: String(i), name: 'CC BillPay', date, amount: 50000, transfer: true }),
  );
  assert.deepEqual(recurringBills(transfers, new Date('2026-09-22')), []);
});
