import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AdminApi, type FunnelPeriod, type FunnelPerson, type FunnelReport, type VisitReport } from './adminClient.js';
import { Badge, Banner, Chip, ChipGroup, PageHeader } from '../ui/index.js';

/**
 * [P63-6 · owner] Admin → Funnel: where invited leads and public requests stop. For a period, the count at each step,
 * then one row per lead with each step's date. Everything comes from our own records; the owner's test leads never
 * count. Read-only.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const funnelDay = (ms: number | null): string => { if (ms === null) return ''; const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

const STEPS: Array<{ key: keyof FunnelPerson; label: string }> = [
  { key: 'inviteSentAt', label: 'Invite sent' },
  { key: 'inviteOpenedAt', label: 'Link opened' },
  { key: 'submittedAt', label: 'Form submitted' },
  { key: 'approvedAt', label: 'Approved' },
  { key: 'passwordSetAt', label: 'Password set' },
  { key: 'firstSignInAt', label: 'First sign-in' },
  { key: 'firstClientAt', label: 'First client' },
];
const SOURCE: Record<FunnelPerson['source'], string> = { invite: 'Invite', public: 'Public form', admin: 'Added by you' };

/** Where this person stopped: the first step they have not reached (invite-only steps skipped for the public form). */
export function stoppedAt(p: FunnelPerson): string | null {
  const steps = p.source === 'invite' ? STEPS : STEPS.filter((s) => s.key !== 'inviteSentAt' && s.key !== 'inviteOpenedAt' && (p.source === 'public' || s.key !== 'submittedAt'));
  const next = steps.find((s) => p[s.key] == null);
  return next ? next.label : null;
}

const PAGE_LABEL: Record<keyof VisitReport['byPage'], string> = { landing: 'Landing page', request_access: 'Request access', sign_in: 'Sign-in', privacy: 'Privacy page' };
const pctOf = (x: number): string => `${Math.round(x * 100)}%`;
const dayOf = (iso: string): string => funnelDay(Date.parse(`${iso}T00:00:00Z`));

/** [P63-8 · owner] The cookieless site visits for the period: per day, unique visitors, top referrers, UTM, devices, and
 *  the share of landing-page visitors who reach request access and who submit. */
export function VisitsSection({ visits: v }: { visits: VisitReport }): JSX.Element {
  const views = v.days.reduce((s, d) => s + d.views, 0);
  const uniques = v.days.reduce((s, d) => s + d.uniques, 0);
  return (
    <section data-testid="funnel-visits" className="ui-stack ui-gap-2" style={{ marginBottom: 'var(--space-4)', maxWidth: 520 }}>
      <h2 style={{ fontSize: 'var(--text-title-size)', margin: 'var(--space-4) 0 0' }}>Site visits</h2>
      <p className="ui-caption" style={{ margin: 0 }}>Counted without cookies. A visitor is counted once per day; nothing identifies them.</p>
      <p style={{ margin: 0 }}><strong>{`${views} page views, ${uniques} unique visitors`}</strong></p>
      {v.landingVisitors === 0 ? <p className="ui-secondary" style={{ margin: 0 }}>No landing-page visitors in this period yet.</p> : (
        <>
          <p style={{ margin: 0 }}>{`${pctOf(v.reachedRequestShare ?? 0)} of landing-page visitors reached request access (${v.reachedRequest} of ${v.landingVisitors})`}</p>
          <p style={{ margin: 0 }}>{`${pctOf(v.submittedShare ?? 0)} submitted the form (${v.submitted} of ${v.landingVisitors})`}</p>
        </>
      )}
      <p className="ui-secondary" style={{ margin: 0 }}>{`Phone ${v.devices.phone} · Desktop ${v.devices.desktop}`}</p>
      <p className="ui-secondary" style={{ margin: 0 }}>{(Object.keys(PAGE_LABEL) as Array<keyof VisitReport['byPage']>).map((k) => `${PAGE_LABEL[k]} ${v.byPage[k]}`).join(' · ')}</p>
      {v.days.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 'var(--text-secondary-size)', fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr className="ui-secondary"><th style={{ textAlign: 'left', padding: 'var(--space-1) var(--space-3) var(--space-1) 0' }}>Day</th><th style={{ textAlign: 'right', padding: 'var(--space-1) var(--space-3)' }}>Views</th><th style={{ textAlign: 'right', padding: 'var(--space-1) 0' }}>Unique visitors</th></tr></thead>
          <tbody>
            {v.days.slice().reverse().map((d) => (
              <tr key={d.day}><td style={{ padding: 'var(--space-1) var(--space-3) var(--space-1) 0' }}>{dayOf(d.day)}</td><td style={{ textAlign: 'right', padding: 'var(--space-1) var(--space-3)' }}>{d.views}</td><td style={{ textAlign: 'right', padding: 'var(--space-1) 0' }}>{d.uniques}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 style={{ fontSize: 'var(--text-body-size)', margin: 'var(--space-2) 0 0' }}>Top referrers</h3>
      {v.topReferrers.length === 0 ? <p className="ui-secondary" style={{ margin: 0 }}>None yet (direct visits and our own pages aren’t referrers).</p> : (
        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>{v.topReferrers.map((r) => <li key={r.domain}><span>{r.domain}</span> <span className="ui-secondary">{r.views}</span></li>)}</ul>
      )}
      {v.utm.length > 0 && (
        <>
          <h3 style={{ fontSize: 'var(--text-body-size)', margin: 'var(--space-2) 0 0' }}>Campaigns (UTM)</h3>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>{v.utm.map((u) => <li key={`${u.source}|${u.campaign ?? ''}`}>{u.campaign ? `${u.source} · ${u.campaign}` : u.source} <span className="ui-secondary">{u.views}</span></li>)}</ul>
        </>
      )}
    </section>
  );
}

export function FunnelPanel({ api, onSignedOut }: { api: Pick<AdminApi, 'funnel'>; onSignedOut: () => void }): JSX.Element {
  const [period, setPeriod] = useState<FunnelPeriod>('30d');
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback((err: unknown) => {
    if (err instanceof AdminSignedOutError) onSignedOut(); else setError(err instanceof Error ? err.message : 'Could not load the funnel.');
  }, [onSignedOut]);
  useEffect(() => {
    let live = true;
    setError(null);
    api.funnel(period).then((r) => { if (live) setReport(r); }).catch((err) => { if (live) fail(err); });
    return () => { live = false; };
  }, [api, period, fail]);

  const c = report?.counts;
  const counts: Array<{ label: string; n: number; detail?: string }> = c ? [
    { label: 'Invites sent', n: c.invitesSent },
    { label: 'Invite links opened', n: c.linksOpened },
    { label: 'Forms submitted', n: c.formsSubmitted.total, detail: `${c.formsSubmitted.invite} from an invite, ${c.formsSubmitted.public} from the public form` },
    { label: 'Approved', n: c.approved },
    { label: 'Password set', n: c.passwordSet },
    { label: 'First sign-in', n: c.firstSignIn },
    { label: 'First client', n: c.firstClient },
  ] : [];

  return (
    <>
      <PageHeader title="Funnel" subtitle="Where invited leads and public requests stop." />
      {error && <Banner tone="danger">{error}</Banner>}
      <ChipGroup label="Period">
        <Chip selected={period === '7d'} onClick={() => setPeriod('7d')}>7 days</Chip>
        <Chip selected={period === '30d'} onClick={() => setPeriod('30d')}>30 days</Chip>
        <Chip selected={period === 'all'} onClick={() => setPeriod('all')}>All</Chip>
      </ChipGroup>
      {report === null ? <p>Loading…</p> : (
        <>
          <ol data-testid="funnel-counts" className="ui-stack ui-gap-2" style={{ listStyle: 'none', padding: 0, margin: 'var(--space-4) 0', maxWidth: 520 }}>
            {counts.map((s) => (
              <li key={s.label} data-testid={`funnel-step-${s.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', borderBottom: '1px solid var(--hairline)', paddingBottom: 'var(--space-2)' }}>
                <span>{s.label}{s.detail && <span className="ui-caption" style={{ display: 'block' }}>{s.detail}</span>}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{s.n}</strong>
              </li>
            ))}
          </ol>
          {report.visits && <VisitsSection visits={report.visits} />}
          <h2 style={{ fontSize: 'var(--text-title-size)', margin: 'var(--space-4) 0 var(--space-2)' }}>Each lead</h2>
          {report.rows.length === 0 ? <p className="ui-secondary">No one entered the funnel in this period.</p> : (
            <ul className="ui-stack ui-gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {report.rows.map((p) => {
                const stop = stoppedAt(p);
                return (
                  <li key={p.key} data-testid={`funnel-row-${p.key}`} className="ui-card" style={{ padding: 'var(--space-3)', border: '1px solid var(--hairline)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <strong>{p.name ?? p.email ?? 'Unknown'}</strong>
                      {stop ? <Badge tone="warning">{`Stopped before: ${stop}`}</Badge> : <Badge tone="success">Added a client</Badge>}
                    </div>
                    <p className="ui-caption" style={{ margin: 'var(--space-1) 0 var(--space-2)', overflowWrap: 'anywhere' }}>{[p.email, p.company, SOURCE[p.source]].filter(Boolean).join(' · ')}</p>
                    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-1) var(--space-3)', margin: 0, fontSize: 'var(--text-secondary-size)' }}>
                      {STEPS.filter((s) => p.source === 'invite' || (s.key !== 'inviteSentAt' && s.key !== 'inviteOpenedAt')).map((s) => (
                        <div key={s.key} style={{ display: 'contents' }}>
                          <dt className="ui-secondary">{s.label}</dt>
                          <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{p[s.key] == null ? <span className="ui-secondary">Not yet</span> : funnelDay(p[s.key] as number)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
