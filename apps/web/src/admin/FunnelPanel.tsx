import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AdminApi, type FunnelPeriod, type FunnelPerson, type FunnelReport } from './adminClient.js';
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
