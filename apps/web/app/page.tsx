'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  Headphones,
  Landmark,
  LayoutDashboard,
  Leaf,
  Menu,
  Mic,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Wallet,
  X,
  Zap,
  ShoppingBag,
  Coffee,
  Car,
  Home,
  Utensils,
  Heart,
  Film,
  RefreshCw,
} from 'lucide-react';
import {
  API,
  api,
  Data,
  Diary,
  money,
  dateLabel,
  token,
  supabase,
  signOut,
  Transaction,
} from '@/lib/api';
import Recorder from '@/components/Recorder';
import Assistant from '@/components/Assistant';
import Onboarding from '@/components/Onboarding';
import RegionalSettings from '@/components/RegionalSettings';
import { useDialog } from '@/lib/useDialog';
const nav = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Transactions', icon: ArrowDownLeft },
  { name: 'Budgets', icon: Target },
  { name: 'Bills & reminders', icon: CalendarDays },
  { name: 'Money diary', icon: BookOpen },
  { name: 'Accounts', icon: Landmark },
];
const categoryIcons: Record<string, typeof Coffee> = {
  Groceries: ShoppingBag,
  Dining: Coffee,
  Utilities: Home,
  Transport: Car,
  Shopping: ShoppingBag,
  Health: Heart,
  Entertainment: Film,
  Subscriptions: RefreshCw,
  Other: Wallet,
};
const titles: Record<string, string> = {
  Overview: 'A clearer picture of your money.',
  Transactions: 'The little things add up.',
  Budgets: 'Make room for what matters.',
  'Bills & reminders': 'One less thing on your mind.',
  'Money diary': 'Your money has a story.',
  Accounts: 'All together. All in view.',
  Settings: 'Make FinSight yours.',
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      finsight<span className="brand-dot">.</span>
    </div>
  );
}
function Merchant({ name, category }: { name: string; category: string }) {
  const Icon = categoryIcons[category] || Wallet;
  return (
    <span className={'merchant-icon ' + (name.includes('PAYROLL') ? 'income-icon' : '')}>
      <Icon size={18} />
    </span>
  );
}
export default function Page() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('Overview'),
    [period, setPeriod] = useState('month'),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('All categories'),
    [record, setRecord] = useState(false),
    [assistant, setAssistant] = useState(false),
    [connect, setConnect] = useState(false),
    [billModal, setBillModal] = useState(false),
    [toast, setToast] = useState(''),
    [dark, setDark] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [online, setOnline] = useState(false),
    [notificationPanel, setNotificationPanel] = useState(false),
    [diarySearch, setDiarySearch] = useState(''),
    [diaryResults, setDiaryResults] = useState<Diary[] | null>(null),
    [mode, setMode] = useState('demo'),
    [authVersion, setAuthVersion] = useState(0);
  const notify = useCallback((s: string) => setToast(s), []);
  const load = useCallback(async () => {
    try {
      const result = await api(`/api/dashboard?period=${period}&month=${month}`);
      setData(result);
      setMode(result.mode);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month, period]);
  useEffect(() => {
    void load();
    void fetch(API + '/config')
      .then((r) => r.json())
      .then((c) => setMode(c.mode))
      .catch(() => {});
  }, [load]);
  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined;
    let closed = false;
    void token().then((t) => {
      if (closed) return;
      socket = io(API, { auth: { token: t }, withCredentials: true });
      socket.on('connect', () => {
        setOnline(true);
        void load();
      });
      socket.on('disconnect', (reason) => {
        setOnline(false);
        if (reason === 'io server disconnect') void api('/api/session').catch(() => {});
      });
      socket.on('dashboard:update', () => void load());
    });
    return () => {
      closed = true;
      socket?.disconnect();
    };
  }, [load, authVersion]);
  useEffect(() => {
    const sub = supabase?.auth.onAuthStateChange(() => {
      setAuthVersion((v) => v + 1);
      void load();
    });
    return () => sub?.data.subscription.unsubscribe();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const value = localStorage.getItem('finsight-theme') === 'dark';
    setDark(value);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('finsight-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setRecord(false);
        setAssistant(false);
        setConnect(false);
        setBillModal(false);
        setNotificationPanel(false);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const transactions = useMemo(
    () =>
      data?.transactions
        .filter(
          (t) =>
            (period === 'week'
              ? t.date >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)
              : t.date.startsWith(month)) &&
            t.name.toLowerCase().includes(search.toLowerCase()) &&
            (category === 'All categories' || t.category === category),
        )
        .sort((a, b) => b.date.localeCompare(a.date)) || [],
    [data, month, period, search, category],
  );
  function go(name: string) {
    setTab(name);
    setSearch('');
    setCategory('All categories');
    setMobileNav(false);
  }
  function shiftMonth(amount: number) {
    const d = new Date(month + '-01T12:00:00');
    d.setMonth(d.getMonth() + amount);
    setMonth(d.toISOString().slice(0, 7));
  }
  async function action(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      await load();
      notify(success);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function exportCSV() {
    const rows = [
      ['Date', 'Merchant', 'Category', 'Amount', 'Currency', 'Status'],
      ...transactions.map((t) => [
        t.date,
        t.name,
        t.category,
        (t.amount / 100).toFixed(2),
        t.currency || 'USD',
        t.pending ? 'Pending' : 'Posted',
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'")
                .replaceAll('"', '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `finsight-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Your transactions have been exported.');
  }
  const s = data?.summary,
    bills = s?.bills.filter((b) => b.status !== 'paid') || [];
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileNav ? 'is-open' : '')}>
        <Brand />
        <div className="workspace">
          <span className="workspace-avatar">J</span>
          <div>
            <strong>Personal space</strong>
            <span>Let’s grow together</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">YOUR FINANCES</span>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button key={name} className={tab === name ? 'active' : ''} onClick={() => go(name)}>
              <Icon size={19} />
              {name}
              {name === 'Money diary' && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="plant-art">
              <Leaf size={36} />
              <span />
            </div>
            <strong>
              A little awareness.
              <br />A lasting difference.
            </strong>
            <p>
              Build a healthier relationship
              <br />
              with your money, every day.
            </p>
            <button onClick={() => setRecord(true)}>
              Make time to reflect <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={'nav-setting ' + (tab === 'Settings' ? 'active' : '')}
            onClick={() => go('Settings')}
          >
            <Settings size={18} />
            Settings
          </button>
          <button
            className="nav-setting"
            onClick={() =>
              notify(
                'FinSight keeps your money and reflections together. See README.md for setup and support.',
              )
            }
          >
            <CircleHelp size={18} />
            Help & getting started
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">JD</span>
            <div>
              <strong>{'Your personal space'}</strong>
              <span>{mode === 'demo' ? 'Local account' : 'Private account'}</span>
            </div>
            <button
              className="icon-btn"
              aria-label="Profile settings"
              onClick={() => go('Settings')}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={21} />
            </button>
            <span>Your workspace</span>
            <ChevronRight size={13} />
            <strong>{tab}</strong>
          </div>
          <div className="topbar-actions">
            <span className="private-badge">
              <ShieldCheck size={14} />
              Your space is private
            </span>
            <button
              className="icon-btn"
              onClick={() => setDark(!dark)}
              aria-label="Toggle dark mode"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-btn notification-toggle"
              aria-label="View notifications"
              onClick={() => setNotificationPanel(!notificationPanel)}
            >
              <Bell size={19} />
              {!!s?.alerts.length && <i />}
            </button>
            <span className="top-avatar">JD</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="greeting">
                {tab === 'Overview' ? 'YOUR DAILY DOSE OF CLARITY' : tab.toUpperCase()}
              </div>
              <h1>
                {tab === 'Overview' ? (mode === 'demo' ? 'Welcome back' : 'Welcome back') : tab}
                <span className="heading-dot">.</span>
                {tab === 'Overview' && <span className="greeting-sun">☀</span>}
              </h1>
              <p>{titles[tab]}</p>
            </div>
            <div className="heading-actions">
              {tab === 'Overview' || tab === 'Transactions' ? (
                <>
                  <div className="month-picker">
                    <button aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                      <ChevronLeft size={14} />
                    </button>
                    <CalendarDays size={15} />
                    <span>
                      {new Date(month + '-01T12:00:00').toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                    <button aria-label="Next month" onClick={() => shiftMonth(1)}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <button className="button" onClick={exportCSV}>
                    <Download size={15} />
                    Export
                  </button>
                </>
              ) : tab === 'Money diary' ? (
                <button className="button primary" onClick={() => setRecord(true)}>
                  <Plus size={16} />
                  New reflection
                </button>
              ) : tab === 'Bills & reminders' ? (
                <button className="button primary" onClick={() => setBillModal(true)}>
                  <Plus size={16} />
                  Add a bill
                </button>
              ) : tab === 'Accounts' ? (
                <button className="button primary" onClick={() => setConnect(true)}>
                  <Plus size={16} />
                  Connect account
                </button>
              ) : null}
            </div>
          </div>
          {error && (
            <div className="error-banner">
              <span>
                {error} {error.includes('fetch') ? 'Start the API with npm run dev.' : ''}
              </span>
              <button
                className="button"
                onClick={() => (mode === 'live' ? setConnect(true) : void load())}
              >
                {mode === 'live' ? 'Sign in & verify' : 'Retry'}
              </button>
            </div>
          )}
          {!data && !error && (
            <div className="loading">
              <span className="loading-leaf">
                <Leaf size={30} />
              </span>
              <p>Bringing your financial picture together…</p>
            </div>
          )}
          {data && s && (
            <>
              {mode === 'demo' && (
                <div className="demo-bar">
                  <span>
                    <span className="status-dot" /> Private local workspace. Imported balances
                    reflect each statement’s closing date.
                  </span>
                  <button onClick={() => setConnect(true)}>
                    Connect your world <ArrowRight size={13} />
                  </button>
                </div>
              )}
              {tab === 'Overview' && (
                <>
                  <div className="overview-toolbar">
                    <div className="section-title">
                      Your money, at a glance{' '}
                      <span className="live-pill">
                        <i className={online ? 'connected' : ''} />
                        {online ? 'Live updates' : 'Reconnecting'}
                      </span>
                    </div>
                    <div className="segmented">
                      <button
                        className={period === 'month' ? 'selected' : ''}
                        onClick={() => setPeriod('month')}
                      >
                        This month
                      </button>
                      <button
                        className={period === 'week' ? 'selected' : ''}
                        onClick={() => setPeriod('week')}
                      >
                        This week
                      </button>
                    </div>
                  </div>
                  <div className="metrics-grid">
                    <div className="metric-card profit-card">
                      <div className="metric-label">
                        Available balance{' '}
                        <span>
                          <Wallet size={17} />
                        </span>
                      </div>
                      <h2>{money(s.profit, s.currency)}</h2>
                      <div className="metric-foot">
                        <span className="profit-indicator">
                          <ArrowUpRight size={13} /> Your breathing room
                        </span>
                        <span>after expenses & debt</span>
                      </div>
                      <div className="profit-art">
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">
                        Total income
                        <span className="metric-icon green">
                          <ArrowDownLeft size={18} />
                        </span>
                      </div>
                      <h2>{money(s.income, s.currency)}</h2>
                      <div className="metric-foot">
                        <span className="tiny-dot green-bg" /> Money coming in{' '}
                        <svg viewBox="0 0 84 26">
                          <path d="M1 23 12 20 23 21 35 13 45 16 57 7 68 10 82 2" />
                        </svg>
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">
                        Total expenses
                        <span className="metric-icon tan">
                          <ArrowUpRight size={18} />
                        </span>
                      </div>
                      <h2>{money(s.expenses, s.currency)}</h2>
                      <div className="metric-foot">
                        <span className="tiny-dot tan-bg" /> Intentional, one day at a time
                        <svg className="tan-line" viewBox="0 0 84 26">
                          <path d="M1 8 12 13 23 10 35 19 45 12 57 16 68 10 82 15" />
                        </svg>
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">
                        Outstanding debt
                        <span className="metric-icon lavender">
                          <CreditCard size={17} />
                        </span>
                      </div>
                      <h2>{money(s.debt, s.currency)}</h2>
                      <div className="metric-foot">
                        <span className="tiny-dot lavender-bg" />
                        {data.accounts.filter((a) => a.type === 'credit').length} credit account
                        {data.accounts.filter((a) => a.type === 'credit').length !== 1 ? 's' : ''}
                        <button onClick={() => go('Accounts')}>
                          View <ArrowUpRight size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {s.salary && (
                    <div className="salary-banner">
                      <div className="salary-icon">
                        <Check size={17} />
                      </div>
                      <div>
                        <strong>Payday looks good on you.</strong>
                        <span>
                          {' '}
                          {money(-s.salary.amount, s.currency)} arrived in your account. A fresh
                          start for your goals.
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          go('Transactions');
                          setSearch('PAYROLL');
                        }}
                      >
                        View deposit <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  <div className="charts-grid">
                    <section className="card cashflow">
                      <div className="card-heading">
                        <div>
                          <h3>Money in, money out</h3>
                          <p>A little perspective on your cash flow.</p>
                        </div>
                        <div className="chart-legend">
                          <span>
                            <i className="income-swatch" />
                            Income
                          </span>
                          <span>
                            <i className="expense-swatch" />
                            Expenses
                          </span>
                        </div>
                      </div>
                      <Cashflow
                        transactions={data.transactions}
                        month={month}
                        currency={s.currency}
                      />
                      <div className="chart-footer">
                        <span>
                          <Leaf size={14} /> Every bit you keep is a step forward.
                        </span>
                        <strong>
                          {s.savingsRate}% <span>income retained before debt</span>
                        </strong>
                      </div>
                    </section>
                    <section className="card spending-card">
                      <div className="card-heading">
                        <div>
                          <h3>Where it’s going</h3>
                          <p>Your spending, thoughtfully sorted.</p>
                        </div>
                        <button
                          className="icon-btn"
                          aria-label="View category details"
                          onClick={() => go('Transactions')}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </div>
                      <div className="spending-body">
                        <div className="donut" style={{ background: donut(s.spending) }}>
                          <div>
                            <span>Total spent</span>
                            <strong>{money(s.expenses, s.currency)}</strong>
                            <span>{s.spending.length} categories</span>
                          </div>
                        </div>
                        <div className="category-legend">
                          {s.spending
                            .slice()
                            .sort((a, b) => b.amount - a.amount)
                            .slice(0, 5)
                            .map((c) => (
                              <button
                                key={c.name}
                                onClick={() => {
                                  go('Transactions');
                                  setCategory(c.name);
                                }}
                              >
                                <span className="legend-dot" style={{ background: c.color }} />
                                <span>{c.name}</span>
                                <strong>{money(c.amount, s.currency)}</strong>
                              </button>
                            ))}
                        </div>
                      </div>
                      <button className="card-link" onClick={() => go('Transactions')}>
                        Explore your spending <ArrowRight size={14} />
                      </button>
                    </section>
                  </div>
                  <div className="lower-grid">
                    <section className="card transactions-card">
                      <div className="card-heading">
                        <div>
                          <h3>The latest little details</h3>
                          <p>Recent activity across your accounts.</p>
                        </div>
                        <button className="text-button" onClick={() => go('Transactions')}>
                          View all <ArrowRight size={14} />
                        </button>
                      </div>
                      <TransactionTable
                        transactions={transactions.slice(0, 5)}
                        accounts={data.accounts}
                      />
                    </section>
                    <section className="card bills-card">
                      <div className="card-heading">
                        <div>
                          <h3>Coming up next</h3>
                          <p>A heads-up for the days ahead.</p>
                        </div>
                        <CalendarDays size={18} />
                      </div>
                      <div className="bill-list">
                        {bills.slice(0, 3).map((b) => (
                          <div className="bill-row" key={b.id}>
                            <div className="bill-date">
                              <span>
                                {new Date(b.due + 'T12:00:00').toLocaleDateString('en-US', {
                                  month: 'short',
                                })}
                              </span>
                              <strong>{Number(b.due.slice(8))}</strong>
                            </div>
                            <div>
                              <strong>{b.name}</strong>
                              <span>{b.status === 'overdue' ? 'Overdue' : b.category}</span>
                            </div>
                            <strong>{money(b.amount, s.currency)}</strong>
                          </div>
                        ))}
                        {!bills.length && (
                          <p className="empty">All caught up. A little peace of mind.</p>
                        )}
                      </div>
                      <button className="card-link" onClick={() => go('Bills & reminders')}>
                        See all bills & reminders <ArrowRight size={14} />
                      </button>
                    </section>
                  </div>
                  <div className="reflection-banner">
                    <div className="reflection-icon">
                      <AudioLines size={28} />
                    </div>
                    <div>
                      <span className="eyebrow">MORE THAN NUMBERS</span>
                      <h3>How do you feel about your money today?</h3>
                      <p>A quick reflection can turn small moments into meaningful insights.</p>
                    </div>
                    <button className="button" onClick={() => setRecord(true)}>
                      <Mic size={16} />
                      Capture a thought <ArrowUpRight size={14} />
                    </button>
                  </div>
                </>
              )}
              {tab === 'Transactions' && (
                <section className="card">
                  <div className="list-controls">
                    <div className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="Search transactions"
                        placeholder="Search transactions…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option>All categories</option>
                      {Object.keys(categoryIcons).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <span className="muted small">{transactions.length} transactions</span>
                  </div>
                  <TransactionTable transactions={transactions} accounts={data.accounts} />
                </section>
              )}
              {tab === 'Budgets' && (
                <>
                  <div className="info-strip">
                    <Sparkles size={18} />
                    <span>
                      Budgets shaped by your spending history. Adjust them to fit your life.
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        action(
                          () => api('/api/budgets/generate', { method: 'POST' }),
                          'Budgets regenerated from previous months.',
                        )
                      }
                    >
                      Auto-generate <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="budget-grid">
                    {data.budgets.map((b) => {
                      const spent = s.spending.find((c) => c.name === b.category)?.amount || 0;
                      const pct = b.limit ? Math.round((spent / b.limit) * 100) : 0;
                      const Icon = categoryIcons[b.category] || Wallet;
                      return (
                        <section className="card budget-card" key={b.category}>
                          <div className="budget-title">
                            <span className="merchant-icon">
                              <Icon size={22} />
                            </span>
                            <h3>{b.category}</h3>
                            <span className={'budget-status ' + (pct > 100 ? 'over' : '')}>
                              {pct > 100 ? 'Over budget' : 'On track'}
                            </span>
                          </div>
                          <div className="budget-value">
                            {money(spent, s.currency)}
                            <span> of {money(b.limit, s.currency)}</span>
                          </div>
                          <div className="budget-track">
                            <i
                              style={{
                                width: Math.min(pct, 100) + '%',
                                background: pct > 100 ? '#c38870' : '#92a883',
                              }}
                            />
                          </div>
                          <div className="budget-details">
                            <span>{money(Math.max(0, b.limit - spent), s.currency)} left</span>
                            <span>{pct}% used</span>
                          </div>
                          <label className="budget-edit">
                            Monthly limit ({s.currency})
                            <input
                              aria-label={b.category + ' budget'}
                              type="number"
                              min="0"
                              step="10"
                              defaultValue={b.limit / 100}
                              key={b.limit}
                              onBlur={(e) => {
                                const limit = Math.round(Number(e.target.value) * 100);
                                if (limit !== b.limit && Number.isFinite(limit) && limit >= 0)
                                  void action(
                                    () =>
                                      api('/api/budgets', {
                                        method: 'PUT',
                                        body: JSON.stringify({
                                          budgets: data.budgets.map((x) => ({
                                            category: x.category,
                                            limit: x.category === b.category ? limit : x.limit,
                                          })),
                                        }),
                                      }),
                                    'Budget updated.',
                                  );
                              }}
                            />
                          </label>
                        </section>
                      );
                    })}
                  </div>
                </>
              )}
              {tab === 'Bills & reminders' && (
                <>
                  <div className="bill-summary">
                    <div className="card">
                      <span>Upcoming bills</span>
                      <h2>{bills.length}</h2>
                    </div>
                    <div className="card">
                      <span>Total to plan for</span>
                      <h2>
                        {money(
                          bills.reduce((sum, b) => sum + b.amount, 0),
                          s.currency,
                        )}
                      </h2>
                    </div>
                    <div className="card">
                      <span>Reminder preferences</span>
                      <h2 className="reminder-value">
                        {data.preferences.leadHours
                          .map((h) => (h === 72 ? '3 days' : h === 24 ? '24 hrs' : '1 hr'))
                          .join(' · ') || 'Off'}
                      </h2>
                      <button className="text-button" onClick={() => go('Settings')}>
                        Customize <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h3>Your bill timeline</h3>
                        <p>Paid status reconciles automatically with posted bank transactions.</p>
                      </div>
                    </div>
                    {s.bills.map((b) => (
                      <div className="bill-row full-bill" key={b.id}>
                        <div className="bill-date">
                          <span>
                            {new Date(b.due + 'T12:00:00').toLocaleDateString('en-US', {
                              month: 'short',
                            })}
                          </span>
                          <strong>{Number(b.due.slice(8))}</strong>
                        </div>
                        <div>
                          <strong>{b.name}</strong>
                          <span>{b.category}</span>
                        </div>
                        <span className={'status-chip ' + b.status}>{b.status}</span>
                        <strong>{money(b.amount, s.currency)}</strong>
                      </div>
                    ))}
                    {!s.bills.length && (
                      <div className="empty">
                        No recurring bills detected yet. Add a bill to get started.
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === 'Money diary' && (
                <>
                  <div className="diary-hero">
                    <div>
                      <span className="eyebrow">A SPACE FOR YOU</span>
                      <h2>
                        Because your financial wellbeing
                        <br />
                        is about more than a balance.
                      </h2>
                      <p>Notice a pattern. Celebrate a win. Let a thought go.</p>
                      <button className="button primary" onClick={() => setRecord(true)}>
                        <Mic size={17} />
                        Start a reflection
                      </button>
                    </div>
                    <div className="diary-art">
                      <AudioLines size={80} />
                      <span className="orbit one" />
                      <span className="orbit two" />
                    </div>
                  </div>
                  <form
                    className="search-box diary-search"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!diarySearch.trim()) {
                        setDiaryResults(null);
                        return;
                      }
                      try {
                        setDiaryResults(
                          (await api('/api/diary/search?q=' + encodeURIComponent(diarySearch)))
                            .entries,
                        );
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <Search size={17} />
                    <input
                      aria-label="Search diary"
                      placeholder="Find a thought, feeling or goal…"
                      value={diarySearch}
                      onChange={(e) => {
                        setDiarySearch(e.target.value);
                        if (!e.target.value) setDiaryResults(null);
                      }}
                    />
                    <button className="text-button">Search</button>
                  </form>
                  <div className="diary-grid">
                    {(diaryResults || data.diaries).map((d) => (
                      <article className="card diary-card" key={d.id}>
                        <div className="diary-date">
                          <BookOpen size={16} />
                          {dateLabel(d.createdAt)}
                          <span>Personal reflection</span>
                        </div>
                        <p>{d.transcript}</p>
                        <div className="diary-tags">
                          {d.tags.map((t) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <div className="diary-bottom">
                          <span>{d.transactionIds?.length || 0} same-day transactions</span>
                          {d.hasAudio && (
                            <button
                              className="text-button"
                              onClick={async () => {
                                try {
                                  const auth = await token();
                                  const result = await fetch(API + `/api/diary/${d.id}/audio`, {
                                    credentials: 'include',
                                    headers: { Authorization: 'Bearer ' + auth },
                                  });
                                  if (!result.ok) throw new Error('Audio unavailable');
                                  const url = URL.createObjectURL(await result.blob());
                                  const audio = new Audio(url);
                                  audio.onended = () => URL.revokeObjectURL(url);
                                  await audio.play();
                                } catch (e) {
                                  notify((e as Error).message);
                                }
                              }}
                            >
                              <Headphones size={14} />
                              Listen
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {diaryResults?.length === 0 && (
                    <p className="empty">No reflections found. Try another thought or feeling.</p>
                  )}
                </>
              )}
              {tab === 'Accounts' && (
                <>
                  <div className="info-strip">
                    <ShieldCheck size={19} />
                    <span>
                      Statement imports stay in your workspace. Balances reflect the statement date;
                      bank connections use read-only access.
                    </span>
                  </div>
                  <div className="accounts-grid">
                    {data.accounts.map((a, i) => (
                      <article className={'account-card card account-' + i} key={a.id}>
                        <div>
                          <Landmark size={25} />
                          <span className="status-chip">
                            {a.balanceAsOf
                              ? `Statement · ${a.balanceAsOf}`
                              : mode === 'demo'
                                ? 'Sample account'
                                : 'Connected'}
                          </span>
                        </div>
                        <span className="eyebrow">
                          {a.type === 'credit'
                            ? 'CREDIT CARD'
                            : a.name.toLowerCase().includes('saving')
                              ? 'SAVINGS'
                              : 'CHECKING'}
                        </span>
                        <h3>{a.name}</h3>
                        <span className="account-mask">
                          •••• &nbsp; •••• &nbsp; {a.mask} &nbsp; {a.currency}
                        </span>
                        <div className="account-balance">
                          <span>
                            {a.type === 'credit' ? 'Outstanding balance' : 'Current balance'}
                          </span>
                          <strong>{money(a.balance, a.currency)}</strong>
                        </div>
                      </article>
                    ))}
                    <button className="account-add" onClick={() => setConnect(true)}>
                      <Plus size={30} />
                      <strong>Bring another account in</strong>
                      <span>A more complete picture of your finances.</span>
                    </button>
                  </div>
                  {mode === 'demo' && (
                    <button
                      className="button"
                      onClick={() =>
                        action(
                          () => api('/api/demo/transaction', { method: 'POST' }),
                          'Sample coffee purchase added. Dashboard updated over WebSocket.',
                        )
                      }
                    >
                      <Zap size={16} />
                      Simulate a new transaction
                    </button>
                  )}
                </>
              )}
              {tab === 'Settings' && (
                <section className="card settings-card">
                  <h3>Your preferences</h3>
                  <RegionalSettings preferences={data.preferences} onSaved={load} />
                  <div className="setting-row">
                    <div>
                      <strong>Dark appearance</strong>
                      <p>A softer view for quieter evenings.</p>
                    </div>
                    <button
                      className={'toggle ' + (dark ? 'on' : '')}
                      aria-label="Toggle dark appearance"
                      aria-pressed={dark}
                      onClick={() => setDark(!dark)}
                    >
                      <i />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Bill reminder timing</strong>
                      <p>Due dates are scheduled at 12:00 UTC.</p>
                    </div>
                    <div className="lead-options">
                      {[72, 24, 1].map((h) => (
                        <label key={h}>
                          <input
                            type="checkbox"
                            checked={data.preferences.leadHours.includes(h)}
                            onChange={() =>
                              action(
                                () =>
                                  api('/api/preferences', {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                      ...data.preferences,
                                      leadHours: data.preferences.leadHours.includes(h)
                                        ? data.preferences.leadHours.filter((x) => x !== h)
                                        : [...data.preferences.leadHours, h],
                                    }),
                                  }),
                                'Reminder preferences saved.',
                              )
                            }
                          />
                          {h === 72 ? '3 days' : h === 24 ? '24 hours' : '1 hour'}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Push notifications</strong>
                      <p>
                        {data.preferences.notifications
                          ? 'Notifications enabled on this account.'
                          : 'Get a gentle nudge before a bill is due.'}
                      </p>
                    </div>
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          if (data.preferences.notifications) {
                            await api('/api/preferences', {
                              method: 'PUT',
                              body: JSON.stringify({ ...data.preferences, notifications: false }),
                            });
                            await load();
                            return;
                          }
                          const c = await fetch(API + '/config').then((r) => r.json());
                          if (!c.pushReady)
                            throw new Error(
                              'Configure VAPID keys on the server to enable push notifications.',
                            );
                          if ((await Notification.requestPermission()) !== 'granted')
                            throw new Error('Allow notifications in browser settings.');
                          const sw = await navigator.serviceWorker.register('/sw.js');
                          await navigator.serviceWorker.ready;
                          const base64 = c.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
                          const key = Uint8Array.from(atob(base64), (x) => x.charCodeAt(0));
                          const sub = await sw.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: key,
                          });
                          const json = sub.toJSON();
                          await api('/api/push', {
                            method: 'POST',
                            body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
                          });
                          await api('/api/preferences', {
                            method: 'PUT',
                            body: JSON.stringify({ ...data.preferences, notifications: true }),
                          });
                          await load();
                          notify('Push reminders enabled.');
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }}
                    >
                      {data.preferences.notifications ? 'Disable' : 'Enable notifications'}
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Account & security</strong>
                      <p>
                        {mode === 'demo'
                          ? 'Password-protected local access.'
                          : 'Google sign-in and authenticator-based verification.'}
                      </p>
                    </div>
                    <button
                      className="button"
                      onClick={() => window.dispatchEvent(new Event('finsight-security'))}
                    >
                      Change password <ShieldCheck size={15} />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Session</strong>
                      <p>
                        {mode === 'demo'
                          ? 'You’re using a password-protected local account.'
                          : 'Your session is stored in memory.'}
                      </p>
                    </div>
                    {
                      <button
                        className="button"
                        onClick={async () => {
                          try {
                            await signOut();
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        Sign out
                      </button>
                    }
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <span className="tiny-dot green-bg" />
                  {(data?.currencies?.length || 0) > 1
                    ? `${mode === 'demo' ? 'Local data' : 'Showing'} ${s?.currency || 'USD'} (also has ${data!.currencies.filter((c) => c !== s?.currency).join(', ')})`
                    : mode === 'demo'
                      ? `Local data · ${s?.currency || 'USD'}`
                      : `All amounts in ${s?.currency || 'USD'}`}
                  <span className="footer-divider">/</span>Made for your peace of mind.
                </span>
                <span>
                  <ShieldCheck size={13} /> A little clarity goes a long way.
                </span>
              </footer>
            </>
          )}
        </main>
        <div className="floating-actions">
          <button
            className="floating-mic"
            aria-label="Record a diary entry"
            onClick={() => setRecord(true)}
          >
            <Mic size={20} />
          </button>
          <button className="assistant-pill" onClick={() => setAssistant(true)}>
            <Sparkles size={17} />
            Ask FinSight<span>↗</span>
          </button>
        </div>
      </div>
      {record && (
        <Recorder
          mode={mode}
          onClose={() => setRecord(false)}
          onSaved={() => {
            void load();
            notify('Your reflection is saved.');
          }}
        />
      )}
      {assistant && (
        <>
          <div className="drawer-scrim" onClick={() => setAssistant(false)} />
          <Assistant onClose={() => setAssistant(false)} />
        </>
      )}
      {connect && data && (
        <Onboarding
          preferences={data.preferences}
          mode={mode}
          onClose={() => setConnect(false)}
          onComplete={load}
        />
      )}
      {billModal && (
        <BillModal
          currency={s?.currency || 'USD'}
          onClose={() => setBillModal(false)}
          onSave={async (b) => {
            await api('/api/bills', { method: 'POST', body: JSON.stringify(b) });
            await load();
            notify('Bill reminder added.');
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button className="icon-btn" aria-label="Dismiss message" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {notificationPanel && (
        <div className="notification-panel">
          <div className="card-heading">
            <h3>Your updates</h3>
            <button
              aria-label="Close notifications"
              className="icon-btn"
              onClick={() => setNotificationPanel(false)}
            >
              <X size={16} />
            </button>
          </div>
          {s?.alerts.length ? (
            s.alerts.map((a) => (
              <div className="alert-item" key={a.id}>
                <Activity size={16} />
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              <ShieldCheck size={28} />
              <p>
                No unusual charges detected.
                <br />
                We’ll keep an eye on things.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function donut(spending: { color: string; amount: number }[]) {
  const total = spending.reduce((s, c) => s + c.amount, 0);
  let p = 0;
  return total
    ? 'conic-gradient(' +
        spending
          .map((c) => {
            const from = p;
            p += (c.amount / total) * 100;
            return `${c.color} ${from}% ${p}%`;
          })
          .join(',') +
        ')'
    : '#eee';
}
function Cashflow({
  transactions,
  month,
  currency,
}: {
  transactions: Transaction[];
  month: string;
  currency: string;
}) {
  // Scoped to one currency so a mixed USD/INR account set never sums into one meaningless bar.
  const currencyTransactions = transactions.filter((t) => (t.currency || 'USD') === currency);
  const groups = Array.from({ length: 6 }, (_, i) => {
    const start = i * 5 + 1,
      end = i === 5 ? 31 : start + 4;
    const t = currencyTransactions.filter(
      (t) =>
        t.date.startsWith(month) &&
        Number(t.date.slice(8)) >= start &&
        Number(t.date.slice(8)) <= end &&
        !t.pending,
    );
    return {
      income: -t.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0),
      expense: t.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      label: `${String(start).padStart(2, '0')}–${String(end).padStart(2, '0')}`,
    };
  });
  const max = Math.max(10000, ...groups.map((g) => Math.max(g.income, g.expense)));
  const axisLabel = (cents: number) =>
    new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  return (
    <div className="bar-chart">
      <div className="chart-y">
        {[1, 0.75, 0.5, 0.25, 0].map((x) => (
          <span key={x}>{axisLabel(Math.round(max * x))}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="grid-lines">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} />
          ))}
        </div>
        <div className="bar-groups">
          {groups.map((g) => (
            <div className="bar-group" key={g.label}>
              <div className="bar-pair">
                <div
                  className="chart-bar income"
                  style={{ height: Math.max(2, (g.income / max) * 100) + '%' }}
                  title={'Income: ' + money(g.income, currency)}
                />
                <div
                  className="chart-bar expense"
                  style={{ height: Math.max(2, (g.expense / max) * 100) + '%' }}
                  title={'Expenses: ' + money(g.expense, currency)}
                />
              </div>
              <span>{g.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function TransactionTable({
  transactions,
  accounts,
}: {
  transactions: Transaction[];
  accounts: Data['accounts'];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Category</th>
            <th>Date</th>
            <th className="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="merchant-cell">
                  <Merchant name={t.name} category={t.category} />
                  <div>
                    <strong>{t.name.replace(' · PAYROLL', '')}</strong>
                    <span>
                      {accounts.find((a) => a.id === t.accountId)?.name || 'Connected account'}
                      {t.pending ? ' · Pending' : ''}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <span className={'category-chip ' + (t.amount < 0 ? 'income-chip' : '')}>
                  {t.amount < 0 ? 'Income' : t.category}
                </span>
              </td>
              <td>{dateLabel(t.date)}</td>
              <td className={'amount ' + (t.amount < 0 ? 'positive' : '')}>
                {t.amount < 0 ? '+' : '−'}
                {money(Math.abs(t.amount), t.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!transactions.length && (
        <p className="empty">No transactions here yet. Try a different month or category.</p>
      )}
    </div>
  );
}
function BillModal({
  currency,
  onClose,
  onSave,
}: {
  currency: string;
  onClose: () => void;
  onSave: (b: { name: string; amount: number; due: string; category: string }) => Promise<void>;
}) {
  useDialog();
  const [name, setName] = useState(''),
    [amount, setAmount] = useState(''),
    [due, setDue] = useState(new Date().toISOString().slice(0, 10)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              name,
              amount: Math.round(Number(amount) * 100),
              due,
              category: 'Other',
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <button
          type="button"
          className="icon-btn modal-close"
          aria-label="Close bill form"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">A LITTLE PLANNING GOES A LONG WAY</span>
        <h2 id="bill-title">Make space for a bill.</h2>
        <label className="form-label">
          Bill name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Internet"
          />
        </label>
        <label className="form-label">
          Amount ({currency})
          <input
            required
            type="number"
            min=".01"
            step=".01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="form-label">
          Due date
          <input required type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} className="button primary full">
          {busy ? 'Saving…' : 'Add bill reminder'}
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
