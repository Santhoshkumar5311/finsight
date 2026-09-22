'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
export type RegionalPreferences = { region?: string };
type Catalog = {
  regions: { code: string; name: string; providerName: string | null; available: boolean }[];
};
export default function RegionalSettings({
  preferences,
  onSaved,
}: {
  preferences: RegionalPreferences;
  onSaved: () => void | Promise<void>;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [region, setRegion] = useState(preferences.region || 'US'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api('/api/regions')
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch((e) => {
        if (active) {
          setMessage(e.message);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setRegion(preferences.region || 'US');
  }, [preferences.region]);
  async function save() {
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ region }) });
      await onSaved();
      setMessage('Bank region saved.');
    } catch (e) {
      setMessage((e as Error).message);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const selected = catalog?.regions.find((r) => r.code === region);
  return (
    <section className="regional-settings" aria-label="Bank region">
      <h3>Bank region</h3>
      <p className="muted small">Choose the country where your bank is located.</p>
      <div className="regional-fields">
        <label>
          Country
          <select
            value={region}
            disabled={busy || !catalog}
            onChange={(e) => {
              setRegion(e.target.value);
              setMessage('');
            }}
          >
            {catalog?.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="regional-provider">
          <span className="muted small">Bank connection</span>
          <strong>{selected?.providerName || 'Not available yet'}</strong>
          {selected?.providerName && !selected.available && (
            <span className="muted small">Requires configured live services</span>
          )}
        </div>
      </div>
      <p className="muted small">Your existing accounts and their currencies stay unchanged.</p>
      <button
        className="button primary"
        disabled={busy || !catalog || region === preferences.region}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save bank region'}
      </button>
      {message && (
        <p role={failed ? 'alert' : 'status'} className={failed ? 'error small' : 'small'}>
          {message}
        </p>
      )}
    </section>
  );
}
