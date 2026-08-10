import { useEffect, useState } from 'react';
import type { LedgerSummary, LedgerEventType } from './ledgerClient.js';

export interface LedgerApi {
  summary(): Promise<LedgerSummary | null>;
  setDealValue(clientId: string, aed: number): Promise<boolean>;
}

const LABEL: Record<LedgerEventType, string> = {
  promise_kept: 'promise kept on time',
  thread_reopened: 'thread reopened',
  brief_before_meeting: 'brief before a meeting',
};

/**
 * The Recovered Value Ledger (P4-11). Language is "touched", never "closed" or
 * "won" — no causal claims. AED shows only when the rep has entered deal values.
 */
export function Ledger({ api, clients }: { api: LedgerApi; clients: Array<{ id: string; name: string }> }): JSX.Element {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [aed, setAed] = useState('');

  const load = (): Promise<void> =>
    api.summary().then((s) => {
      if (s) { setSummary(s); setState('ready'); } else setState('error');
    });
  useEffect(() => { void load(); }, [api]);

  async function saveDealValue(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const value = Number(aed);
    if (!clientId || !Number.isFinite(value) || value < 0) return;
    if (await api.setDealValue(clientId, value)) {
      setAed('');
      void load();
    }
  }

  if (state === 'loading') return <p>Loading your ledger…</p>;
  if (state === 'error' || !summary) return <p role="alert">Couldn’t load your ledger.</p>;

  return (
    <section aria-label="Recovered value">
      <h2 style={{ marginTop: 0 }}>Value Tovira touched</h2>

      {summary.totalTouched === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Nothing yet — as you act on flags and keep promises, they’ll show here.</p>
      ) : (
        <>
          <p data-testid="headline" className="tov-statement" style={{ paddingTop: 8 }}>
            Tovira touched <strong className="tov-mono">{summary.totalTouched}</strong> opportunit{summary.totalTouched === 1 ? 'y' : 'ies'}
            {summary.aed !== null && <> · <strong className="tov-mono">AED {summary.aed.toLocaleString()}</strong> of your pipeline</>}.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0' }}>
            {(Object.keys(summary.byType) as LedgerEventType[])
              .filter((t) => summary.byType[t] > 0)
              .map((t) => (
                <li
                  key={t}
                  data-testid={`type-${t}`}
                  style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}
                >
                  <span className="tov-mono" style={{ color: 'var(--brass)' }}>{summary.byType[t]} ×</span>{' '}
                  <span>{LABEL[t]}</span>
                </li>
              ))}
          </ul>
        </>
      )}

      {clients.length > 0 && (
        <form onSubmit={saveDealValue} style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <label>
            Deal value for{' '}
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Deal value client">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <input value={aed} onChange={(e) => setAed(e.target.value)} inputMode="numeric" placeholder="AED" aria-label="Deal value (AED)" style={{ width: 120 }} />
          <button type="submit" disabled={!aed.trim()}>Save</button>
        </form>
      )}
    </section>
  );
}
