export const categories = [
  'Groceries',
  'Dining',
  'Utilities',
  'Transport',
  'Shopping',
  'Health',
  'Entertainment',
  'Subscriptions',
  'Other',
];
export const colors = [
  '#cfef6b',
  '#82987b',
  '#a0bac4',
  '#dbbc9b',
  '#aba1c7',
  '#e4b0ae',
  '#a8c4a0',
  '#a8a9a3',
  '#dddcd4',
];
export const day = (date = new Date()) => new Date(date).toISOString().slice(0, 10);
const currencyLocales = { USD: 'en-US', INR: 'en-IN' };
export const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat(currencyLocales[currency], { style: 'currency', currency }).format(
    cents / 100,
  );
// Accounts/transactions carry their own currency; this never converts between them.
export function currenciesPresent(state) {
  return [
    ...new Set(
      [...(state.accounts || []), ...(state.transactions || [])]
        .map((x) => x.currency)
        .filter(Boolean),
    ),
  ];
}
export function primaryCurrency(state) {
  return currenciesPresent(state)[0] || 'USD';
}
const patterns = {
  Groceries:
    /grocery|groceries|whole foods|trader joe|safeway|market|bigbasket|dmart|zepto|blinkit/i,
  Dining: /restaurant|coffee|cafe|starbucks|chipotle|dining|doordash|zomato|swiggy/i,
  Utilities:
    /electric|water|internet|utility|utilities|comcast|rent|airtel|jio\b|vodafone|tatapower|bses|electricity board/i,
  Transport: /uber|lyft|gas|fuel|transit|transport|\bola\b|rapido|irctc|metro/i,
  Shopping: /amazon|target|shop|clothing|nike|flipkart|myntra|ajio/i,
  Health: /pharmacy|health|medical|cvs|fitness|gym|apollo|practo/i,
  Entertainment: /cinema|movie|concert|entertainment|bookmyshow|pvr|inox/i,
  Subscriptions: /netflix|spotify|apple.com|adobe|subscription|icloud|hotstar|prime video/i,
};
export function categorize(name, primary = '') {
  return Object.entries(patterns).find(([, re]) => re.test(name + ' ' + primary))?.[0] || 'Other';
}
export function isTransfer(t) {
  return (
    t.transfer || /TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS|CREDIT_CARD_PAYMENT/.test(t.primary || '')
  );
}
export function salaries(transactions) {
  return transactions
    .filter((t) => t.amount < 0 && !t.pending && !isTransfer(t))
    .filter((t) => {
      if (/payroll|direct dep|salary/i.test(t.name)) return true;
      const similar = transactions.filter(
        (x) =>
          x.id !== t.id &&
          x.name === t.name &&
          x.amount < 0 &&
          Math.abs(x.amount - t.amount) < Math.abs(t.amount) * 0.05,
      );
      return similar.some((x) => {
        const days = Math.abs(new Date(x.date) - new Date(t.date)) / 864e5;
        return [7, 14, 15, 30, 31].some((d) => Math.abs(days - d) <= 2);
      });
    });
}
export function recurringBills(transactions, now = new Date()) {
  const groups = new Map();
  for (const t of transactions.filter((t) => t.amount > 0 && !t.pending && !isTransfer(t))) {
    const key = t.name.toLowerCase().replace(/\d+/g, '').trim();
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const bills = [];
  for (const [key, group] of groups) {
    const list = group.sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) continue;
    const latest = list.at(-1),
      prev = list.at(-2),
      gap = (new Date(latest.date) - new Date(prev.date)) / 864e5;
    const cadence = [7, 14, 30, 365].find((d) => Math.abs(gap - d) <= (d === 30 ? 5 : 2));
    if (!cadence) continue;
    const due = new Date(latest.date + 'T12:00:00Z');
    if (cadence === 30) {
      const n = due.getUTCDate();
      due.setUTCDate(1);
      due.setUTCMonth(due.getUTCMonth() + 1);
      const last = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
      due.setUTCDate(Math.min(n, last));
    } else due.setUTCDate(due.getUTCDate() + cadence);
    bills.push({
      id: 'auto-' + latest.id,
      name: latest.name,
      amount: latest.amount,
      due: day(due),
      status: day(due) < day(now) ? 'overdue' : 'upcoming',
      category: latest.category,
      cadence,
      detected: true,
      key,
    });
  }
  return bills;
}
export function anomalies(transactions) {
  const alerts = [],
    seen = new Map();
  for (const t of [...transactions]
    .filter((t) => !t.pending && t.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `${t.name}:${t.amount}:${t.date}`;
    if (seen.has(key))
      alerts.push({
        id: 'duplicate-' + t.id,
        type: 'duplicate',
        title: 'Possible duplicate charge',
        detail: `${t.name} · ${money(t.amount)} appears twice on ${t.date}.`,
        transactionId: t.id,
      });
    seen.set(key, t.id);
    if (t.category === 'Subscriptions') {
      const prev = transactions
        .filter(
          (x) =>
            x.id !== t.id && x.name === t.name && x.date < t.date && x.amount > 0 && !x.pending,
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev && t.amount > prev.amount * 1.1)
        alerts.push({
          id: 'spike-' + t.id,
          type: 'price-spike',
          title: 'Subscription price increased',
          detail: `${t.name} increased from ${money(prev.amount)} to ${money(t.amount)}.`,
          transactionId: t.id,
        });
    }
  }
  return alerts;
}
export function makeBudgets(
  transactions,
  now = new Date(),
  currency = transactions.find((t) => t.currency)?.currency || 'USD',
) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = transactions.filter(
    (t) =>
      (t.currency || 'USD') === currency &&
      new Date(t.date) < cutoff &&
      t.amount > 0 &&
      !t.pending &&
      !isTransfer(t),
  );
  const months = new Set(previous.map((t) => t.date.slice(0, 7))).size || 1;
  return categories.map((category) => ({
    id: category,
    category,
    limit:
      Math.ceil(
        previous.filter((t) => t.category === category).reduce((s, t) => s + t.amount, 0) /
          months /
          1000,
      ) * 1000 || 10000,
  }));
}
export function summarize(
  state,
  {
    month = day().slice(0, 7),
    period = 'month',
    now = new Date(),
    currency = primaryCurrency(state),
  } = {},
) {
  const end = day(now),
    start = day(new Date(now.getTime() - 6 * 864e5));
  // Scoping every aggregate to one currency first means USD and INR (or any other pair) are never summed together.
  const currencyTransactions = state.transactions.filter((t) => (t.currency || 'USD') === currency);
  const tx = currencyTransactions.filter(
    (t) =>
      !t.pending &&
      !isTransfer(t) &&
      (period === 'week' ? t.date >= start && t.date <= end : t.date.startsWith(month)),
  );
  // All values are integer minor units (cents/paise). A credit balance is a liability; negative deposit balances are overdrafts.
  const creditAccounts = new Set(
    state.accounts.filter((a) => a.type === 'credit' && a.id).map((a) => a.id),
  );
  const expense = (t) => t.amount > 0 || creditAccounts.has(t.accountId);
  const income = tx
      .filter((t) => t.amount < 0 && !creditAccounts.has(t.accountId))
      .reduce((s, t) => s - t.amount, 0),
    expenses = tx.filter(expense).reduce((s, t) => s + t.amount, 0);
  const debt = state.accounts
    .filter((a) => (a.currency || 'USD') === currency)
    .reduce(
      (s, a) => s + (a.type === 'credit' ? Math.max(0, a.balance) : Math.max(0, -a.balance)),
      0,
    );
  const spending = categories
    .map((name, i) => ({
      name,
      color: colors[i],
      amount: tx.filter((t) => t.category === name && expense(t)).reduce((s, t) => s + t.amount, 0),
    }))
    .filter((x) => x.amount > 0);
  const bills = [
    ...state.bills,
    ...recurringBills(currencyTransactions, now).filter(
      (b) => !state.bills.some((x) => x.name === b.name),
    ),
  ]
    .map((b) => {
      const paid = currencyTransactions.some(
        (t) =>
          t.name.toLowerCase() === b.name.toLowerCase() &&
          !t.pending &&
          t.amount > 0 &&
          Math.abs(t.amount - b.amount) <= Math.max(100, b.amount * 0.05) &&
          Math.abs(new Date(t.date) - new Date(b.due)) / 864e5 <= 3,
      );
      return { ...b, status: paid ? 'paid' : b.due < day(now) ? 'overdue' : 'upcoming' };
    })
    .sort((a, b) => a.due.localeCompare(b.due));
  return {
    currency,
    income,
    expenses,
    debt,
    profit: income - expenses - debt,
    spending,
    bills,
    salary:
      salaries(currencyTransactions)
        .filter((t) => tx.some((x) => x.id === t.id))
        .at(-1) || null,
    alerts: anomalies(currencyTransactions),
    savingsRate: income ? Math.round(((income - expenses) / income) * 100) : 0,
    updatedAt: new Date().toISOString(),
    month,
    period,
  };
}
export function diaryTags(text) {
  const tags = [];
  if (/spend|bought|guilt|shopping/i.test(text)) tags.push('mindful spending');
  if (/save|saving|goal|future/i.test(text)) tags.push('savings goal');
  if (/worry|stress|anxious/i.test(text)) tags.push('money feelings');
  if (/grateful|happy|proud/i.test(text)) tags.push('small wins');
  return tags.length ? tags : ['daily reflection'];
}
export function forecastNextMonth(state, now = new Date(), currency = primaryCurrency(state)) {
  const current = day(now).slice(0, 7),
    next = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))).slice(0, 7);
  const posted = state.transactions.filter(
    (t) => (t.currency || 'USD') === currency && !t.pending && !isTransfer(t),
  );
  const months = [
    ...new Set(posted.filter((t) => t.date.slice(0, 7) < current).map((t) => t.date.slice(0, 7))),
  ]
    .sort()
    .slice(-3);
  if (!months.length) return null;
  const history = posted.filter((t) => months.includes(t.date.slice(0, 7))),
    fixedCategories = ['Utilities', 'Subscriptions'];
  const creditAccounts = new Set(
    state.accounts.filter((a) => a.type === 'credit' && a.id).map((a) => a.id),
  );
  const expense = (t) => t.amount > 0 || creditAccounts.has(t.accountId);
  const income = Math.round(
    history
      .filter((t) => t.amount < 0 && !creditAccounts.has(t.accountId))
      .reduce((s, t) => s - t.amount, 0) / months.length,
  );
  const fixed = Math.round(
    history
      .filter((t) => expense(t) && fixedCategories.includes(t.category))
      .reduce((s, t) => s + t.amount, 0) / months.length,
  );
  const variable = Math.round(
    history
      .filter((t) => expense(t) && !fixedCategories.includes(t.category))
      .reduce((s, t) => s + t.amount, 0) / months.length,
  );
  const currentSummary = summarize(state, { now, currency });
  const knownBills = currentSummary.bills
    .filter((b) => b.due.startsWith(next) && b.status !== 'paid')
    .reduce((s, b) => s + b.amount, 0);
  const expenses = variable + Math.max(fixed, knownBills),
    debt = currentSummary.debt;
  return {
    currency,
    month: next,
    income,
    expenses,
    debt,
    profit: income - expenses - debt,
    historyMonths: months,
    knownBills,
    variableExpenses: variable,
    fixedExpenses: Math.max(fixed, knownBills),
  };
}
