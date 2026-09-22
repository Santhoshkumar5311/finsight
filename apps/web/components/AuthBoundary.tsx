'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Leaf, ShieldCheck, LockKeyhole, LoaderCircle } from 'lucide-react';
import { API, api, supabase } from '@/lib/api';

type Configuration = { mode: string; authProvider: 'local' | 'supabase'; setupRequired: boolean };
type View = 'login' | 'signup' | 'forgot' | 'recovery' | 'mfa' | 'password';
export default function AuthBoundary({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [authorized, setAuthorized] = useState(false),
    [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('login'),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState(''),
    [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [factor, setFactor] = useState(''),
    [qr, setQr] = useState(''),
    [code, setCode] = useState('');
  const recovery = useRef(false),
    path = usePathname(),
    router = useRouter();
  const check = useCallback(async () => {
    try {
      const result = await fetch(API + '/config', { cache: 'no-store' });
      if (!result.ok) throw new Error('FinSight is unavailable. Check that the API is running.');
      const c: Configuration = await result.json();
      setConfig(c);
      if (c.authProvider === 'supabase' && !supabase)
        throw new Error(
          'Live authentication is not configured. Set the public Supabase URL and anon key, then rebuild the web app.',
        );
      if (recovery.current) return;
      if (c.setupRequired) {
        setAuthorized(false);
        setView('signup');
        return;
      }
      if (c.authProvider === 'supabase') {
        const session = await supabase!.auth.getSession();
        if (!session.data.session) {
          setAuthorized(false);
          setView('login');
          return;
        }
        const assurance = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance.error) throw assurance.error;
        if (assurance.data.currentLevel !== 'aal2') {
          setAuthorized(false);
          setView('mfa');
          return;
        }
      }
      await api('/api/session');
      setAuthorized(true);
      setView('login');
      setError('');
    } catch (e) {
      setAuthorized(false);
      if (!(e as Error).message.includes('Sign in')) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovery.current = true;
        setAuthorized(false);
        setView('recovery');
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setAuthorized(false);
        setView('login');
      } else
        setTimeout(() => {
          if (!recovery.current) void check();
        }, 0);
    });
    const lost = () => {
      setAuthorized(false);
      setView('login');
    };
    const security = () => {
      setPassword('');
      setConfirmation('');
      setError('');
      setView('password');
    };
    window.addEventListener('finsight-auth-lost', lost);
    window.addEventListener('finsight-security', security);
    void check();
    return () => {
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener('finsight-auth-lost', lost);
      window.removeEventListener('finsight-security', security);
    };
  }, [check]);
  useEffect(() => {
    if (!authorized) return;
    const timer = setInterval(() => {
      void api('/api/session').catch(() => setAuthorized(false));
    }, 60000);
    return () => clearInterval(timer);
  }, [authorized]);
  useEffect(() => {
    if (authorized && path === '/login') router.replace('/');
  }, [authorized, path, router]);
  function change(next: View) {
    setView(next);
    setPassword('');
    setConfirmation('');
    setError('');
    setNotice('');
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepareMfa() {
    if (!supabase) return;
    const listed = await supabase.auth.mfa.listFactors();
    if (listed.error) throw listed.error;
    const existing = listed.data.totp.find((f) => f.status === 'verified');
    if (existing) {
      setFactor(existing.id);
      setQr('');
      return;
    }
    for (const pending of listed.data.all.filter(
      (f) => f.factor_type === 'totp' && f.status === 'unverified',
    )) {
      const removed = await supabase.auth.mfa.unenroll({ factorId: pending.id });
      if (removed.error) throw removed.error;
    }
    const enrolled = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FinSight authenticator',
    });
    if (enrolled.error) throw enrolled.error;
    setFactor(enrolled.data.id);
    setQr(enrolled.data.totp.qr_code);
  }
  async function submit() {
    if (view === 'mfa') {
      const verified = await supabase!.auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (verified.error) throw verified.error;
      setCode('');
      setQr('');
      setFactor('');
      await check();
      return;
    }
    if (view === 'forgot') {
      if (config?.authProvider === 'local') {
        setNotice(
          'Local accounts do not send email. The account owner can follow the local recovery instructions in docs/AUTHENTICATION.md. Your encrypted diary is preserved.',
        );
        return;
      }
      const result = await supabase!.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/login',
      });
      if (result.error) throw result.error;
      setNotice('If this email has an account, a password reset link will arrive shortly.');
      return;
    }
    if (['signup', 'recovery', 'password'].includes(view)) {
      if (password.length < 12) throw new Error('Use at least 12 characters.');
      if (password !== confirmation) throw new Error('Passwords do not match.');
    }
    if (view === 'recovery' || view === 'password') {
      if (config?.authProvider === 'local')
        await api('/api/session/password', {
          method: 'POST',
          body: JSON.stringify({ email, currentPassword, password }),
        });
      else {
        const result = await supabase!.auth.updateUser({ password });
        if (result.error) throw result.error;
      }
      recovery.current = false;
      setPassword('');
      setConfirmation('');
      setCurrentPassword('');
      await check();
      return;
    }
    if (config?.authProvider === 'local') {
      await api(view === 'signup' ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setPassword('');
      setConfirmation('');
      await check();
      return;
    }
    if (view === 'signup') {
      const result = await supabase!.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + '/login' },
      });
      if (result.error) throw result.error;
      setPassword('');
      setConfirmation('');
      setNotice('Check your email to confirm your account, then sign in.');
      setView('login');
      if (result.data.session) await check();
    } else {
      const result = await supabase!.auth.signInWithPassword({ email, password });
      if (result.error)
        throw new Error('Unable to sign in. Check your credentials and email confirmation.');
      setPassword('');
      await check();
    }
  }
  if (authorized && view !== 'password' && path !== '/login') return children;
  const title =
    view === 'signup'
      ? config?.setupRequired
        ? 'Create your local account'
        : 'Create your account'
      : view === 'forgot'
        ? 'Reset your password'
        : view === 'mfa'
          ? 'One more layer of protection'
          : ['recovery', 'password'].includes(view)
            ? 'Choose a new password'
            : 'Welcome back.';
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a href="/" className="auth-brand">
          <Leaf size={30} /> finsight<span>.</span>
        </a>
        <div>
          <span className="eyebrow">YOUR MONEY. YOUR STORY.</span>
          <h1>
            A little clarity.
            <br />A better tomorrow.
          </h1>
          <p>
            A private space to understand your spending, plan your next step, and make room for what
            matters.
          </p>
          <div className="auth-promise">
            <ShieldCheck size={20} /> Thoughtful tools. Clear boundaries. Your control.
          </div>
        </div>
        <small>Personal finance, with a little more perspective.</small>
      </section>
      <section className="auth-content">
        <div className="auth-card">
          <div className="setup-icon">
            <LockKeyhole size={26} />
          </div>
          <h2>{loading ? 'Opening your private space…' : title}</h2>
          {loading ? (
            <LoaderCircle className="spin" aria-label="Loading authentication" />
          ) : (
            <>
              <p className="muted">
                {config?.authProvider === 'local'
                  ? 'Local testing · your diary stays on this computer.'
                  : 'Sign in securely to access your financial diary.'}
              </p>
              {config && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(submit);
                  }}
                  className="auth-form"
                >
                  {view === 'mfa' ? (
                    <>
                      <p>
                        Use your authenticator app to verify your identity before accessing
                        financial data.
                      </p>
                      {!factor ? (
                        <button
                          className="button primary full"
                          type="button"
                          disabled={busy}
                          onClick={() => void run(prepareMfa)}
                        >
                          Set up or verify authenticator
                        </button>
                      ) : (
                        <>
                          {qr && (
                            <img
                              src={qr}
                              alt="Scan with your authenticator app"
                              width={200}
                              height={200}
                            />
                          )}
                          <label>
                            Six-digit code
                            <input
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              pattern="[0-9]{6}"
                              maxLength={6}
                              required
                              value={code}
                              onChange={(e) => setCode(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {!['recovery'].includes(view) &&
                        (view !== 'password' || config.authProvider === 'local') && (
                          <label>
                            Email address
                            <input
                              type="email"
                              autoComplete="username"
                              required
                              maxLength={254}
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@example.com"
                            />
                          </label>
                        )}
                      {view === 'password' && config.authProvider === 'local' && (
                        <label>
                          Current password
                          <input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                          />
                        </label>
                      )}
                      {view !== 'forgot' && (
                        <label>
                          {view === 'login' ? 'Password' : 'New password'}
                          <input
                            type="password"
                            autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                            required
                            minLength={view === 'login' ? 1 : 12}
                            maxLength={128}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </label>
                      )}
                      {['signup', 'recovery', 'password'].includes(view) && (
                        <label>
                          Confirm password
                          <input
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={12}
                            maxLength={128}
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                          />
                          <small>At least 12 characters. A memorable passphrase works well.</small>
                        </label>
                      )}
                    </>
                  )}
                  {(view !== 'mfa' || factor) && (
                    <button className="button primary full" disabled={busy} type="submit">
                      {busy ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <>
                          {view === 'signup'
                            ? 'Create account'
                            : view === 'forgot'
                              ? 'Send reset instructions'
                              : view === 'mfa'
                                ? 'Verify and continue'
                                : ['recovery', 'password'].includes(view)
                                  ? 'Update password'
                                  : 'Sign in'}{' '}
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  )}
                </form>
              )}
              {view === 'login' && config?.authProvider === 'supabase' && (
                <button
                  className="button full"
                  disabled={busy || !supabase}
                  onClick={() =>
                    void run(async () => {
                      const r = await supabase!.auth.signInWithOAuth({
                        provider: 'google',
                        options: { redirectTo: location.origin + '/login' },
                      });
                      if (r.error) throw r.error;
                    })
                  }
                >
                  Continue with Google
                </button>
              )}
              <div className="auth-links">
                {view === 'login' ? (
                  <>
                    <button className="text-button" onClick={() => change('forgot')}>
                      Forgot password?
                    </button>
                    {config?.authProvider === 'supabase' && (
                      <button className="text-button" onClick={() => change('signup')}>
                        Create an account
                      </button>
                    )}
                  </>
                ) : view === 'mfa' ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        await supabase?.auth.signOut({ scope: 'local' });
                        setFactor('');
                        setQr('');
                        change('login');
                      })
                    }
                  >
                    Use another account
                  </button>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (view === 'password') {
                        setView('login');
                      } else change('login');
                    }}
                  >
                    {view === 'password' ? 'Back to dashboard' : 'Back to sign in'}
                  </button>
                )}
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {!config && !loading && (
            <button
              className="button full"
              onClick={() => {
                setLoading(true);
                void check();
              }}
            >
              Retry connection
            </button>
          )}
          <div className="security-note">
            <ShieldCheck size={16} />{' '}
            {config?.authProvider === 'local'
              ? 'Encrypted local diary · no default password'
              : 'Multi-factor authentication required'}
          </div>
        </div>
      </section>
    </main>
  );
}
