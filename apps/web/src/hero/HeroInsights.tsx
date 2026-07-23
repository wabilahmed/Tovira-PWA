import { useEffect, useState } from 'react';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';

export interface HeroApi {
  status(): Promise<GateState | null>;
  patterns(): Promise<Pattern[]>;
  risk(): Promise<RiskItem[]>;
  today(): Promise<TodayAction[]>;
}

/**
 * The hero surface (P4b-*). "Today" is always on. Cross-client patterns and the
 * risk radar are volume-gated: below the threshold we show an honest "warming up"
 * state that says exactly what unlocks them, not a broken/empty feature.
 */
export function HeroInsights({ api }: { api: HeroApi }): JSX.Element {
  const [status, setStatus] = useState<GateState | null>(null);
  const [actions, setActions] = useState<TodayAction[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [risk, setRisk] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void Promise.all([api.status(), api.today(), api.patterns(), api.risk()]).then(([s, t, p, r]) => {
      if (!live) return;
      setStatus(s);
      setActions(t);
      setPatterns(p);
      setRisk(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [api]);

  if (loading) return <p>Working out your day…</p>;

  return (
    <section aria-label="Insights">
      <h2 style={{ marginTop: 0 }}>What to do today</h2>
      {actions.length === 0 ? (
        <p style={{ color: '#666' }}>Nothing urgent right now.</p>
      ) : (
        <ol data-testid="today-list">
          {actions.map((a, i) => (
            <li key={i}>{a.text}</li>
          ))}
        </ol>
      )}

      <h2>Patterns &amp; risk</h2>
      {status && !status.unlocked ? (
        <div role="status" style={warmBox}>
          <p style={{ margin: 0 }}>{status.message}</p>
          <small style={{ color: '#666' }}>
            {status.needed.clients > 0 && `${status.needed.clients} more client(s)`}
            {status.needed.clients > 0 && status.needed.notes > 0 && ' · '}
            {status.needed.notes > 0 && `${status.needed.notes} more note(s)`}
            {' to unlock.'}
          </small>
        </div>
      ) : (
        <>
          {patterns.length === 0 && risk.length === 0 && <p style={{ color: '#666' }}>No patterns or risks surfaced yet.</p>}
          {patterns.map((p) => (
            <div key={p.id} data-testid="pattern" style={card}>
              <strong>{p.title}</strong> <span style={badge}>{p.confidence}</span>
              <p style={{ margin: '0.25rem 0' }}>{p.description}</p>
              {p.evidence.length > 0 && (
                <small style={{ color: '#888' }}>Evidence: {p.evidence.map((e) => e.name).join(', ')}</small>
              )}
            </div>
          ))}
          {risk.map((r) => (
            <div key={r.clientId} data-testid="risk" style={{ ...card, borderColor: '#fca5a5' }}>
              <strong>{r.name} — at risk</strong>
              <ul style={{ margin: '0.25rem 0 0' }}>
                {r.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

const warmBox: React.CSSProperties = { border: '1px dashed #cbd5e1', borderRadius: 8, padding: '0.75rem 1rem', background: '#f8fafc' };
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.5rem 0' };
const badge: React.CSSProperties = { fontSize: '0.7rem', background: '#e0e7ff', color: '#3730a3', borderRadius: 999, padding: '0.1rem 0.5rem' };
