'use client';
import { useDialog } from '@/lib/useDialog';
import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { X, ShieldCheck, Landmark, ArrowRight, LoaderCircle, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import RegionalSettings, { type RegionalPreferences } from './RegionalSettings';
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
      {'Continue with Plaid'} <ArrowRight size={17} />
    </button>
  );
}
// There is no live Account Aggregator connection configured (see docs/INDIA_BANKING.md):
// FinSight has no TSP/FIU registration or ICICI approval. This offers only what actually
// works today: a fixture-data sandbox (when explicitly enabled) and statement import.
function IndiaConnect({
  onImported,
  onError,
}: {
  onImported: (summary: string) => void;
  onError: (e: string) => void;
}) {
  const [sandboxEnabled, setSandboxEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    api('/api/india/status')
      .then((s) => setSandboxEnabled(!!s.sandboxEnabled))
      .catch(() => setSandboxEnabled(false));
  }, []);
  async function trySandbox() {
    setBusy(true);
    try {
      const consent = await api('/api/india/consent', { method: 'POST' });
      const result = await api('/api/india/import-sandbox', {
        method: 'POST',
        body: JSON.stringify({ consentId: consent.consentId }),
      });
      onImported(`${result.imported} sandbox transaction(s) imported.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('statement', file);
      const result = await api('/api/accounts/import/icici', { method: 'POST', body });
      onImported(
        `${result.imported} transaction(s) imported` +
          (result.skipped ? `, ${result.skipped} row(s) skipped` : '') +
          '.',
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setFile(null);
    }
  }
  return (
    <>
      <div className="notice">
        {sandboxEnabled
          ? 'A local Account Aggregator sandbox is enabled for testing the connection flow with fixture data — this is not a real bank connection.'
          : 'India supports ICICI statement import. Live Account Aggregator connectivity is not configured.'}
      </div>
      {sandboxEnabled && (
        <button className="button full" onClick={trySandbox} disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            'Try sandbox connection (fixture data)'
          )}
        </button>
      )}
      <label className="button full" style={{ cursor: 'pointer' }}>
        <Upload size={15} /> {file ? file.name : 'Choose ICICI PDF, XLS or CSV'}
        <input
          type="file"
          accept=".csv,.xls,.pdf,text/csv,application/vnd.ms-excel,application/pdf"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <button className="button primary full" onClick={upload} disabled={busy || !file}>
        {busy ? <LoaderCircle size={16} className="spin" /> : 'Import statement'}
      </button>
      <span className="muted small">
        Upload an ICICI transaction-history XLS/CSV or a credit-card statement PDF. No NetBanking
        password, MPIN, PIN, CVV or OTP is ever requested by FinSight.
      </span>
    </>
  );
}
export default function Onboarding({
  mode,
  preferences,
  onClose,
  onComplete,
}: {
  mode: string;
  preferences: RegionalPreferences;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  useDialog();
  const [token, setToken] = useState(''),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const country = preferences.region || 'US';
  useEffect(() => {
    setToken('');
    setStep(0);
    setError('');
    setNotice('');
  }, [country]);
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const status = await api('/api/plaid/status');
        if (!cancelled && status.complete) {
          setStep(3);
          void onComplete();
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
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
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn modal-close" aria-label={'Close'} onClick={onClose}>
          <X size={20} />
        </button>
        <div className="setup-icon">
          <Landmark size={27} />
        </div>
        <h2 id="connect-title">{'Connect your bank'}</h2>
        {step === 0 && <RegionalSettings preferences={preferences} onSaved={onComplete} />}
        {step === 0 && country === 'US' && (
          <>
            <p className="notice">{'United States'} · Plaid</p>
            {mode === 'demo' ? (
              <p className="muted">{'Live bank connection is not configured in local mode.'}</p>
            ) : (
              <button
                className="button primary full"
                onClick={() => void connect()}
                disabled={busy}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : 'Continue with Plaid'}
              </button>
            )}
          </>
        )}
        {step === 0 && country === 'IN' && (
          <IndiaConnect
            onImported={(message) => {
              setNotice(message);
              setStep(3);
              void onComplete();
            }}
            onError={setError}
          />
        )}
        {step === 0 && country === 'OTHER' && (
          <p className="notice">{'No bank provider is available for this region yet.'}</p>
        )}
        {step === 1 && token && (
          <>
            <Link token={token} onSuccess={() => setStep(2)} onError={setError} />
            <button
              className="button full"
              onClick={() => {
                setToken('');
                setStep(0);
              }}
            >
              {'Cancel'}
            </button>
          </>
        )}
        {step === 2 && (
          <div className="import-progress">
            <div className="progress-track">
              <div />
            </div>
            <p>{'Importing up to 90 days of transactions…'}</p>
          </div>
        )}
        {step === 3 && (
          <>
            <div className="notice">{notice || 'Accounts'}</div>
            <button className="button primary full" onClick={onClose}>
              {'Go to my dashboard'}
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="security-note">
          <ShieldCheck size={15} />
          {'Read-only bank access. Your credentials stay with your bank.'}
        </div>
      </section>
    </div>
  );
}
