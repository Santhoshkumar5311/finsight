import { randomUUID } from 'node:crypto';
import { categorize, day, makeBudgets } from '@finsight/core';
export function seed() {
  const now = new Date(),
    date = (offset, d) =>
      day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, d)));
  const accounts = [
    {
      id: 'checking',
      name: 'Everyday Checking',
      institution: 'Chase',
      type: 'depository',
      mask: '4829',
      balance: 1248250,
      currency: 'USD',
    },
    {
      id: 'savings',
      name: 'High-Yield Savings',
      institution: 'Marcus',
      type: 'depository',
      mask: '1093',
      balance: 2480000,
      currency: 'USD',
    },
    {
      id: 'credit',
      name: 'Sapphire Preferred',
      institution: 'Chase',
      type: 'credit',
      mask: '8102',
      balance: 42800,
      currency: 'USD',
    },
  ];
  const transactions = [];
  function add(name, amount, d, offset = 0, accountId = 'checking') {
    transactions.push({
      id: randomUUID(),
      name,
      amount,
      date: date(offset, d),
      category: categorize(name),
      accountId,
      pending: false,
      currency: 'USD',
    });
  }
  for (const offset of [-2, -1, 0]) {
    add('Acme Studio · PAYROLL', -625000, 1, offset);
    const entries = [
      ['Whole Foods Market', 12648, 3],
      ['Spotify Premium', 1199, 4],
      ['Blue Bottle Coffee', 680, 5],
      ['Apartment rent', 125000, 1],
      ['Amazon', 8999, 6],
      ['Uber', 2450, 7],
      ['Trader Joe’s', 7835, 8],
      ['Sweetgreen restaurant', 1840, 9],
      ['Internet', 6999, 10],
      ['Nike', 12500, 11],
      ['Netflix', 1599, 12],
      ['Whole Foods Market', 9240, 13],
      ['Electric utility', 8640, 14],
      ['CVS Pharmacy', 2840, 15],
      ['Blue Bottle Coffee', 680, 16],
      ['Cinema', 3200, 17],
      ['Trader Joe’s', 6540, 19],
      ['Uber', 1870, 21],
      ['Restaurant dinner', 8620, 23],
      ['Apple.com', 299, 25],
    ];
    for (const [n, a, d] of entries) if (offset < 0 || d <= now.getUTCDate()) add(n, a, d, offset);
  }
  const today = day();
  transactions.push({
    id: randomUUID(),
    name: 'Figma subscription',
    amount: 1500,
    date: today,
    category: 'Subscriptions',
    accountId: 'credit',
    pending: false,
    currency: 'USD',
  });
  const bills = [
    {
      id: randomUUID(),
      name: 'Adobe Creative Cloud',
      amount: 5999,
      due: day(new Date(now.getTime() + 2 * 864e5)),
      category: 'Subscriptions',
      status: 'upcoming',
    },
    {
      id: randomUUID(),
      name: 'Internet',
      amount: 6999,
      due: day(new Date(now.getTime() + 4 * 864e5)),
      category: 'Utilities',
      status: 'upcoming',
    },
    {
      id: randomUUID(),
      name: 'Apartment rent',
      amount: 125000,
      due: date(1, 1),
      category: 'Utilities',
      status: 'upcoming',
    },
  ];
  const diaries = [
    {
      id: randomUUID(),
      transcript:
        'Skipped the impulse purchase today and put that money toward my Japan trip. Small steps, but I’m proud of myself.',
      tags: ['savings goal', 'small wins'],
      createdAt: new Date(now.getTime() - 864e5).toISOString(),
      transactionIds: [],
    },
    {
      id: randomUUID(),
      transcript:
        'Coffee with a friend was a good reminder that spending on the things I value feels different. More moments like this.',
      tags: ['mindful spending'],
      createdAt: new Date(now.getTime() - 3 * 864e5).toISOString(),
      transactionIds: [],
    },
  ];
  return {
    accounts,
    transactions,
    bills,
    diaries,
    budgets: makeBudgets(transactions),
    preferences: { leadHours: [72, 24, 1], notifications: false },
    subscriptions: [],
    deliveries: [],
    metrics: null,
  };
}
