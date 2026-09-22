import { createClient } from '@supabase/supabase-js';
export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true } },
      )
    : null;
export async function token() {
  return (await supabase?.auth.getSession())?.data.session?.access_token || '';
}
export async function api(path: string, options: RequestInit = {}) {
  const auth = await token();
  const result = await fetch(API + path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
      ...options.headers,
    },
  });
  const data = await result.json();
  if (!result.ok) {
    if (
      path.startsWith('/api/') &&
      [401, 403].includes(result.status) &&
      typeof window !== 'undefined'
    )
      window.dispatchEvent(new Event('finsight-auth-lost'));
    throw new Error(data.error || 'Request failed');
  }
  return data;
}
const currencyLocales: Record<string, string> = { USD: 'en-US', INR: 'en-IN' };
export const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat(currencyLocales[currency], { style: 'currency', currency }).format(
    cents / 100,
  );
export const dateLabel = (date: string) =>
  new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
export type Transaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
  category: string;
  accountId: string;
  pending: boolean;
  currency: string;
};
export type Bill = {
  id: string;
  name: string;
  amount: number;
  due: string;
  category: string;
  status: string;
};
export type Diary = {
  id: string;
  transcript: string;
  tags: string[];
  createdAt: string;
  transactionIds: string[];
  hasAudio?: boolean;
};
export type Data = {
  mode: string;
  currencies: string[];
  accounts: {
    id: string;
    name: string;
    type: string;
    mask: string;
    balance: number;
    balanceAsOf?: string;
    currency: string;
  }[];
  transactions: Transaction[];
  bills: Bill[];
  diaries: Diary[];
  budgets: { category: string; limit: number }[];
  preferences: { leadHours: number[]; notifications: boolean; region: string };
  summary: {
    currency: string;
    income: number;
    expenses: number;
    debt: number;
    profit: number;
    savingsRate: number;
    month: string;
    period: string;
    updatedAt: string;
    salary: Transaction | null;
    spending: { name: string; color: string; amount: number }[];
    bills: Bill[];
    alerts: { id: string; title: string; detail: string }[];
  };
};

export async function signOut() {
  await api('/api/session/logout', { method: 'POST' });
  if (supabase) {
    const result = await supabase.auth.signOut({ scope: 'local' });
    if (result.error) throw result.error;
  }
  window.dispatchEvent(new Event('finsight-auth-lost'));
}
