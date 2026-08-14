import { useEffect, useState } from 'react';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';

export interface HeroApi {
  status(): Promise<GateState | null>;
  patterns(): Promise<Pattern[]>;
  risk(): Promise<RiskItem[]>;
  today(): Promise<TodayAction[]>;
  refreshToday(): Promise<{ actions: TodayAction[]; refreshesRemaining: number } | 'rate_limited' | null>;
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
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  async function refresh(): Promise<void> {
    setRefreshing(true);
    const r = await api.refreshToday();
    setRefreshing(false);
    if (r === 'rate_limited') {
      setRateLimited(true);
      setRefreshMsg('Daily refresh limit reached — your list updates again tomorrow.');
    } else if (r) {
      setActions(r.actions);
      setRateLimited(r.refreshesRemaining === 0);
      setRefreshMsg(r.refreshesRemaining === 0 ? 'No more refreshes today.' : `${r.refreshesRemaining} refresh${r.refreshesRemaining === 1 ? '' : 'es'} left today.`);
    }
  }

  if (loading) return <p>Working out your day…</p>;

  const needActing = actions.filter((a) => a.kind === 'cold' || a.kind === 'risk').length;

  return (
    <section aria-label="Today's register">
      <header className="tov-screenhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Today&rsquo;s register</h2>
          <div className="tov-screenmeta">
            {actions.length} entr{actions.length === 1 ? 'y' : 'ies'}
            {needActing > 0 && <> · {needActing} need acting on</>}
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing || rateLimited}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {refreshMsg && <p data-testid="refresh-msg" style={{ color: rateLimited ? 'var(--amber)' : 'var(--text-secondary)', fontSize: '0.85rem' }}>{refreshMsg}</p>}
      {actions.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Nothing on the register today. Capture a note after your next conversation and tomorrow&rsquo;s will write itself.</p>
      ) : (
        <ol data-testid="today-list" className="tov-register">
          {actions.map((a, i) => {
            const act = a.kind === 'risk' || a.kind === 'cold'; // overdue/cooling → claret
            return (
              <li key={i}>
                <span className="tov-register__idx">{String(i + 1).padStart(2, '0')}</span>
                {act && <span className="tov-dot tov-dot--claret" aria-hidden="true" style={{ marginTop: 6 }} />}
                <span>
                  <div>{a.text}</div>
                  {a.subline && <div className="tov-stamp" style={{ color: act ? 'var(--claret)' : 'var(--text-secondary)', marginTop: 2 }}>{a.subline}</div>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <h2>Patterns &amp; risk</h2>
      {status && !status.unlocked ? (
        <div role="status" style={warmBox}>
          <p style={{ margin: '0 0 0.6rem' }}>{status.message}</p>
          <div className="tov-mono" style={gateRow}><span>Clients on file</span><span>{pad(status.counts.clients)} / {pad(status.counts.clients + status.needed.clients)}</span></div>
          <div className="tov-mono" style={gateRow}><span>Notes captured</span><span>{pad(status.counts.notes)} / {pad(status.counts.notes + status.needed.notes)}</span></div>
          <small style={{ color: 'var(--text-secondary)' }}>
            {status.needed.clients > 0 && `${status.needed.clients} more clients`}
            {status.needed.clients > 0 && status.needed.notes > 0 && ' and '}
            {status.needed.notes > 0 && `${status.needed.notes} more notes`}.
          </small>
        </div>
      ) : (
        <>
          {patterns.length === 0 && risk.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No patterns or risks surfaced yet.</p>}
          {patterns.map((p) => (
            <div key={p.id} data-testid="pattern" style={card}>
              <strong>{p.title}</strong> <span style={badge}>{p.confidence}</span>
              <p style={{ margin: '0.25rem 0' }}>{p.description}</p>
              {p.evidence.length > 0 && (
                <small style={{ color: 'var(--text-tertiary)' }}>Evidence: {p.evidence.map((e) => e.name).join(', ')}</small>
              )}
            </div>
          ))}
          {risk.map((r) => (
            <div key={r.clientId} data-testid="risk" style={{ ...card, borderColor: 'var(--claret-line)' }}>
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

const pad = (n: number): string => String(n).padStart(2, '0');
const warmBox: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', padding: '0.75rem 1rem', background: 'var(--surface-raised)' };
const gateRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '2px 0' };
const card: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.5rem 0' };
const badge: React.CSSProperties = { fontSize: '0.7rem', background: 'var(--brass-surface)', color: 'var(--brass)', borderRadius: 999, padding: '0.1rem 0.5rem' };
