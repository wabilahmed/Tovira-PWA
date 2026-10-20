import { useEffect, useState } from 'react';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';

export interface HeroApi {
  status(): Promise<GateState | null>;
  patterns(): Promise<Pattern[]>;
  risk(): Promise<RiskItem[]>;
  today(): Promise<{ actions: TodayAction[]; refreshesRemaining: number | null }>;
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
  // [P34-5] No counter while a refresh is left; at zero the button is disabled with the overnight copy.
  const [outOfRefreshes, setOutOfRefreshes] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([api.status(), api.today(), api.patterns(), api.risk()]).then(([s, t, p, r]) => {
      if (!live) return;
      setStatus(s);
      setActions(t.actions);
      setOutOfRefreshes(t.refreshesRemaining === 0);
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
      setOutOfRefreshes(true);
    } else if (r) {
      setActions(r.actions);
      setOutOfRefreshes(r.refreshesRemaining === 0);
    }
  }

  if (loading) return <p>Working out your day…</p>;

  const needActing = actions.filter((a) => a.kind === 'cold' || a.kind === 'risk').length;

  return (
    <section aria-label="Today">
      <header className="tov-screenhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Today</h2>
          <div className="tov-screenmeta">
            {actions.length} entr{actions.length === 1 ? 'y' : 'ies'}
            {needActing > 0 && <> · {needActing} need acting on</>}
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing || outOfRefreshes}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {outOfRefreshes && <p data-testid="refresh-msg" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Updated overnight. Next refresh tomorrow.</p>}
      {actions.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Nothing for today yet. Capture a note after your next conversation and tomorrow&rsquo;s list will write itself.</p>
      ) : (
        <ol data-testid="today-list" className="tov-register">
          {actions.map((a, i) => {
            const act = a.kind === 'risk' || a.kind === 'cold'; // overdue/cooling → claret
            return (
              <li key={i}>
                <span className="tov-register__idx">{String(i + 1).padStart(2, '0')}</span>
                {act && <span className="tov-dot tov-dot--claret" aria-hidden="true" style={{ marginTop: 6 }} />}
                <span>
                  <div><TodayLead action={a} /></div>
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
          <p style={{ margin: '0 0 0.6rem' }}>{gateCopy(status)}</p>
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
          {patterns.length === 0 && risk.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Nothing stands out right now.</p>}
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

/** [P34-2] "**Sara Khan** · Send the floor plans", "**Sara Khan** promised: Send ID document photos", or
 *  "**Your note** · …" when the item genuinely has no client. Older payloads (no clientName/title) fall back to
 *  the action's text as before. */
function TodayLead({ action: a }: { action: TodayAction }): JSX.Element {
  if (a.clientName === undefined) return <>{a.text}</>;
  const who = a.clientName ?? 'Your note';
  return (
    <>
      <strong>{who}</strong>
      {a.owner === 'client' ? ' promised: ' : ' · '}
      <span>{a.title ?? a.text}</span>
    </>
  );
}

/** [P34-6] Why Patterns & risk is empty below the volume gate — quoting the server's REAL thresholds, and only
 *  the dimension(s) still short: "Patterns appear once you have 5 clients and 20 notes. You have 4 clients and
 *  12 notes." / "Patterns appear once you have 20 notes. You have 12." */
export function gateCopy(s: GateState): string {
  const t = s.thresholds ?? { clients: s.counts.clients + s.needed.clients, notes: s.counts.notes + s.needed.notes };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const short = (['clients', 'notes'] as const).filter((k) => s.needed[k] > 0);
  if (short.length === 0) return 'Patterns appear as your book grows.';
  const word = (k: 'clients' | 'notes') => (k === 'clients' ? 'client' : 'note');
  if (short.length === 1) {
    const k = short[0]!;
    return `Patterns appear once you have ${plural(t[k], word(k))}. You have ${s.counts[k]}.`;
  }
  return `Patterns appear once you have ${plural(t.clients, 'client')} and ${plural(t.notes, 'note')}. You have ${plural(s.counts.clients, 'client')} and ${plural(s.counts.notes, 'note')}.`;
}
const warmBox: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', padding: '0.75rem 1rem', background: 'var(--surface-raised)' };
const gateRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '2px 0' };
const card: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.5rem 0' };
const badge: React.CSSProperties = { fontSize: '0.7rem', background: 'var(--brass-surface)', color: 'var(--brass)', borderRadius: 999, padding: '0.1rem 0.5rem' };
