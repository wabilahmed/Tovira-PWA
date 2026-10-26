import { useCallback, useEffect, useState } from 'react';
import { OpsUnauthorizedError } from './opsAccessClient.js';
import type { CostReport, CostView, OpsCostsApi } from './opsCostsClient.js';
import { Wordmark } from '../components/Wordmark.js';
import { Badge, Button, Chip, ChipGroup } from '../ui/index.js';

/**
 * [P44-2 · owner] /ops/costs — what each rep costs and pays, per period. The page holds no credential: the owner types
 * the ops token (the same one, kept for THIS TAB as on /ops/access). Billing period by default (lines up with what
 * each rep pays, so the margin is per rep); calendar month to match the Anthropic and Groq invoices. Read-only.
 */
const TOKEN_KEY = 'tovira.opsToken'; // shared with /ops/access: one token for the ops pages
const readToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t: string | null): void => {
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ms: number): string => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const aed = (x: number): string => x.toFixed(2);
const pct = (x: number | null): string => (x === null ? '—' : `${x.toFixed(1)}%`);

const cell = { padding: 'var(--space-2) var(--space-3)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const, borderBottom: '1px solid var(--hairline)' };
const left = { ...cell, textAlign: 'left' as const };

export function CostsAdmin({ api }: { api: OpsCostsApi }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<CostView>('period');
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refused = useCallback(() => {
    writeToken(null); setToken(null); setReport(null);
    setError('That ops token was refused. Check OPS_TOKEN in tovira/prod/app and try again.');
  }, []);
  useEffect(() => {
    if (!token) return;
    let live = true;
    setError(null);
    api.get(token, view).then((r) => { if (live) setReport(r); }).catch((err) => {
      if (!live) return;
      if (err instanceof OpsUnauthorizedError) refused(); else setError(err instanceof Error ? err.message : 'Could not load the report.');
    });
    return () => { live = false; };
  }, [api, token, view, refused]);

  return (
    <main className="standard" style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-5) var(--space-4)' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-section-size)', margin: 0 }}><Wordmark /></p>
      <h1 style={{ fontSize: 'var(--text-section-size)', margin: 'var(--space-2) 0 var(--space-4)' }}>Costs and margin</h1>
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {!token ? (
        <form onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; writeToken(t); setToken(t); setDraft(''); }}>
          <label htmlFor="ops-token" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>Ops token</label>
          <input id="ops-token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%', maxWidth: 420 }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-secondary-size)' }}>The OPS_TOKEN value from Secrets Manager (tovira/prod/app). Kept for this tab only.</p>
          <button type="submit" className="tov-button">Open</button>
        </form>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <ChipGroup label="Group by">
              <Chip selected={view === 'period'} onClick={() => setView('period')}>Billing period</Chip>
              <Chip selected={view === 'month'} onClick={() => setView('month')}>Calendar month</Chip>
            </ChipGroup>
            <Button size="sm" onClick={() => void api.downloadCsv(token, view).catch((err) => { if (err instanceof OpsUnauthorizedError) refused(); else setError('Could not download the CSV.'); })}>Download CSV</Button>
            <button className="tov-link" style={{ marginLeft: 'auto' }} onClick={() => { writeToken(null); setToken(null); setReport(null); }}>Lock</button>
          </div>

          <p data-testid="costs-note" className="ui-secondary" style={{ fontSize: 'var(--text-secondary-size)', maxWidth: 820 }}>
            Cost is Claude (recorded per call) plus voice notes. Voice-note cost is estimated from recorded audio seconds at the Groq rate
            {report?.voiceRecordedSince ? `, recorded from ${day(report.voiceRecordedSince)}.` : ' (none recorded yet).'}{' '}
            Revenue is what Stripe says was paid: subscription plus top-ups. Embeddings and infrastructure (AWS, database, email) are not included.{' '}
            {view === 'period' ? 'Rows are each rep’s billing period; the cap flag compares spend with the cap the app enforces for that period.' : 'Rows are calendar months (UTC), for matching the provider invoices; the cap applies per billing period, so it is shown in that view.'}
            {' '}Plan is the rep’s current plan.
          </p>

          {report === null ? <p>Loading…</p> : report.rows.length === 0 ? <p>No costs recorded yet.</p> : (
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 'var(--text-secondary-size)', fontVariantNumeric: 'tabular-nums', minWidth: 980 }}>
                <thead>
                  <tr style={{ color: 'var(--text-secondary)' }}>
                    {['Period', 'Email', 'Plan', 'Claude AED', 'Voice AED', 'Total cost', 'Calls', 'By type', 'Revenue AED', 'Margin AED', 'Margin %', ''].map((h, i) => <th key={i} style={i < 3 || i === 7 || i === 11 ? left : cell}>{h}</th>)}
                  </tr>
                </thead>
                {report.totals.map((t) => (
                  <tbody key={t.group}>
                    {report.rows.filter((r) => r.group === t.group).map((r) => (
                      <tr key={`${r.userId}-${r.key}`} data-testid={`cost-row-${r.userId}-${r.key}`} style={r.overCeiling ? { background: 'var(--claret-wash, transparent)' } : undefined}>
                        <td style={left}>{r.periodLabel}</td>
                        <td style={left}>{r.email}</td>
                        <td style={left}>{r.plan}</td>
                        <td style={cell}>{aed(r.claudeAed)}</td>
                        <td style={cell}>{r.voiceAed === null ? <span className="ui-secondary">Not recorded</span> : <>{aed(r.voiceAed)}{r.voiceEstimated ? '*' : ''}</>}</td>
                        <td style={{ ...cell, fontWeight: 600 }}>{aed(r.totalCostAed)}</td>
                        <td style={cell}>{r.calls}</td>
                        <td style={{ ...left, whiteSpace: 'normal' }}>{Object.entries(r.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${aed(v)}`).join(' · ')}</td>
                        <td style={cell}>{aed(r.revenueAed)}</td>
                        <td style={{ ...cell, color: r.marginAed < 0 ? 'var(--claret)' : undefined }}>{aed(r.marginAed)}</td>
                        <td style={cell}>{pct(r.marginPct)}</td>
                        <td style={{ ...left, display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                          {r.overCeiling && <Badge tone="danger">Over AED {report.ceilingAed}</Badge>}
                          {r.cap?.reached && <Badge tone="warning">At cap (AED {r.cap.capAed})</Badge>}
                        </td>
                      </tr>
                    ))}
                    <tr data-testid={`cost-total-${t.group}`} style={{ fontWeight: 600 }}>
                      <td style={left} colSpan={5}>{t.label}</td>
                      <td style={cell}>{aed(t.costAed)}</td>
                      <td style={cell} colSpan={2} />
                      <td style={cell}>{aed(t.revenueAed)}</td>
                      <td style={{ ...cell, color: t.marginAed < 0 ? 'var(--claret)' : undefined }}>{aed(t.marginAed)}</td>
                      <td style={cell}>{pct(t.marginPct)}</td>
                      <td style={cell} />
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {report?.rows.some((r) => r.voiceEstimated) && <p className="ui-secondary" style={{ fontSize: 'var(--text-caption-size)' }}>* voice seconds estimated from the recording size (the provider gave no duration).</p>}
        </>
      )}
    </main>
  );
}
