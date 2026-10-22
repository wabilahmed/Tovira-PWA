import { useEffect, useState } from 'react';
import type { ColdClient, Notification } from './proactiveClient.js';
import { daysSince } from '../format/dates.js';
import { OutcomeControl, type OutcomeChoice } from '../outcomes/OutcomeControl.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { Button } from '../ui/Button.js';

export interface ProactiveApi {
  listCold(): Promise<ColdClient[]>;
  listNotifications(): Promise<Notification[]>;
  runScan(): Promise<boolean>;
}

/** [P20-5] Show only the LATEST daily digest — the server keeps one "Your day" per day, so a few days
 *  of them would otherwise stack up as "1 thing needs you" rows (the rep saw three). Every other
 *  notification type is kept as-is, in the order the API returned them (newest first). */
export function collapseDigests(ns: Notification[]): Notification[] {
  let keptDigest = false;
  return ns.filter((n) => {
    if (n.type !== 'daily_digest') return true;
    if (keptDigest) return false; // a newer digest already kept (API is newest-first)
    keptDigest = true;
    return true;
  });
}

/** In-app alerts + going-cold list — value even when push fails/is off (P3-5).
 *  [OUTCOME-3] when `onSetOutcome` is wired, each going-quiet row carries the won/lost/still-open
 *  control — the deal-risk surface is exactly where a rep knows the answer. */
export function Alerts({ api, now = Date.now(), onSetOutcome }: { api: ProactiveApi; now?: number; onSetOutcome?: (clientId: string, choice: OutcomeChoice) => void | Promise<void> }): JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [cold, setCold] = useState<ColdClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = (): Promise<void> =>
    Promise.all([api.listNotifications(), api.listCold()]).then(([n, c]) => {
      setNotifications(collapseDigests(n)); // [P20-5] one "Your day", not a stack of them
      setCold(c);
      setLoading(false);
    });

  useEffect(() => {
    let live = true;
    void load().then(() => {
      if (!live) return;
    });
    return () => {
      live = false;
    };
  }, [api]);

  async function refresh(): Promise<void> {
    setScanning(true);
    await api.runScan();
    await load();
    setScanning(false);
  }

  if (loading) return <Page testId="alerts-page" label="Alerts"><PageHeader title="Alerts" /><p className="ui-secondary">Loading alerts…</p></Page>;

  return (
    <Page testId="alerts-page" label="Alerts">
      <PageHeader
        title="Alerts"
        subtitle={`${notifications.length} alert${notifications.length === 1 ? '' : 's'}`}
        action={<Button size="sm" onClick={() => void refresh()} loading={scanning}>{scanning ? 'Rescanning…' : 'Rescan'}</Button>}
      />

      {notifications.length === 0 && cold.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Nothing needs you and no one has gone quiet. Tovira speaks rarely. This is what quiet looks like.</p>
      ) : notifications.length === 0 ? null : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li className="tov-stamp" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', paddingBottom: 'var(--space-1)' }}>
            <span>Needs you</span><span>{String(notifications.length).padStart(2, '0')}</span>
          </li>
          {notifications.map((n) => (
            <li key={n.id} data-testid="alert" style={item}>
              <span className="tov-dot tov-dot--claret" aria-hidden="true" style={{ marginTop: 'var(--space-2)' }} />
              <div>
                <strong>{n.title}</strong>
                <div style={{ color: 'var(--text-secondary)' }}>{n.body}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cold.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-5)' }}>
          <li className="tov-stamp" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', paddingBottom: 'var(--space-1)' }}>
            <span>Going quiet</span><span>{String(cold.length).padStart(2, '0')}</span>
          </li>
          {cold.map((c) => {
            const days = daysSince(c.lastTouchedAt, now);
            return (
              <li key={c.id} data-testid="cold-client" style={{ ...item, flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', alignItems: 'baseline' }}>
                  <span>{c.name}</span>{' '}
                  {/* Elapsed silence is a fact — the one place claret may dominate a row (§10). */}
                  <span className="tov-mono" style={{ color: 'var(--claret)', fontSize: 'var(--text-secondary-size)' }}>· silent {days} day{days === 1 ? '' : 's'}</span>
                </div>
                {onSetOutcome && <OutcomeControl clientName={c.name} onChoose={(choice) => onSetOutcome(c.id, choice)} />}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

const item: React.CSSProperties = { display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--hairline)' };
