'use client';
import { useDialog } from '@/lib/useDialog';
import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { X, ShieldCheck, Landmark, Check, ArrowRight, LoaderCircle } from 'lucide-react';
import { api, supabase } from '@/lib/api';
function Link({
  token,
  onSuccess,
  onError,
}: {
  token: string;
  onSuccess: () => void;
  onError: (e: string) => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken) => {
      try {
        await api('/api/plaid/exchange', { method: 'POST', body: JSON.stringify({ publicToken }) });
        onSuccess();
      } catch (e) {
        onError((e as Error).message);
      }
    },
    onExit: (e) => {
      if (e) onError(e.display_message || e.error_message);
    },
  });
  return (
    <button className="button primary full" disabled={!ready} onClick={() => open()}>
      Continue with Plaid <ArrowRight size={17} />
    </button>
  );
}
export default function Onboarding({
  mode,
  onClose,
  onComplete,
}: {
  mode: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  useDialog();
  const [token, setToken] = useState(''),
    [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [factor, setFactor] = useState(''),
    [qr, setQr] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (step !== 2) return;
    const timer = setInterval(async () => {
      try {
        const s = await api('/api/plaid/status');
        if (s.complete) {
          setStep(3);
          onComplete();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [step, onComplete]);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/plaid/link-token', { method: 'POST' });
      setToken(result.link_token);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mfa() {
    if (!supabase) return;
    setError('');
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(error.message);
      return;
    }
    const existing = data.totp.find((f) => f.status === 'verified');
    if (existing) {
      setFactor(existing.id);
      return;
    }
    const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'FinSight' });
    if (result.error) setError(result.error.message);
    else {
      setFactor(result.data.id);
      setQr(result.data.totp.qr_code);
    }
  }
  async function verify() {
    if (!supabase) return;
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code });
    if (result.error) setError(result.error.message);
    else {
      setFactor('');
      setQr('');
      void connect();
    }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn modal-close" aria-label="Close setup" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="setup-icon">
          <Landmark size={27} />
        </div>
        <span className="eyebrow">YOUR FINANCIAL PICTURE, TOGETHER</span>
        <h2 id="connect-title">
          A little connection.
          <br />A lot more clarity.
        </h2>
        <p>Securely bring your accounts into one place.</p>
        <div className="setup-steps">
          {['Sign in', 'Connect', 'Import', 'Ready'].map((s, i) => (
            <span className={i <= step ? 'active' : ''} key={s}>
              <b>{i < step ? <Check size={12} /> : i + 1}</b>
              {s}
            </span>
          ))}
        </div>
        {mode === 'demo' ? (
          <>
            <div className="notice">
              You’re exploring a demo with sample accounts. Real bank connection requires Supabase,
              Plaid and the backend services configured in the project’s .env file.
            </div>
            <button className="button primary full" onClick={onClose}>
              Explore demo accounts <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            {step === 0 && (
              <>
                {supabase && (
                  <>
                    <button
                      className="button full"
                      onClick={() =>
                        supabase?.auth.signInWithOAuth({
                          provider: 'google',
                          options: { redirectTo: location.origin },
                        })
                      }
                    >
                      Sign in with Google
                    </button>
                    <button className="button full" onClick={mfa}>
                      Set up or verify two-factor authentication
                    </button>
                  </>
                )}
                {qr && <img src={qr} width={180} height={180} alt="Scan TOTP setup QR code" />}
                {factor && (
                  <div className="inline-input">
                    <input
                      aria-label="Authenticator code"
                      inputMode="numeric"
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <button className="button primary" onClick={verify}>
                      Verify
                    </button>
                  </div>
                )}
                <button className="button primary full" onClick={connect} disabled={busy}>
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    'Continue to bank connection'
                  )}
                </button>
              </>
            )}
            {step === 1 && token && (
              <Link token={token} onSuccess={() => setStep(2)} onError={setError} />
            )}{' '}
            {step === 2 && (
              <div className="import-progress">
                <div className="progress-track">
                  <div />
                </div>
                <p>Importing up to 90 days of transactions…</p>
                <span className="muted small">
                  This can take a few minutes. You can close this window; syncing continues in the
                  background.
                </span>
              </div>
            )}
            {step === 3 && (
              <>
                <div className="notice">
                  Your accounts are connected. Choose bill reminder lead times in Settings.
                </div>
                <button className="button primary full" onClick={onClose}>
                  Go to my dashboard <ArrowRight size={17} />
                </button>
              </>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="security-note">
          <ShieldCheck size={15} /> Read-only bank access. Your credentials stay with your bank.
        </div>
      </section>
    </div>
  );
}
