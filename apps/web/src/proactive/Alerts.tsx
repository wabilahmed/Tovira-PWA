import { useEffect, useState } from 'react';
import type { ColdClient, Notification } from './proactiveClient.js';
import { daysSince } from '../format/dates.js';

export interface ProactiveApi {
  listCold(): Promise<ColdClient[]>;
  listNotifications(): Promise<Notification[]>;
  runScan(): Promise<boolean>;
}

/** In-app alerts + going-cold list — value even when push fails/is off (P3-5). */
export function Alerts({ api, now = Date.now() }: { api: ProactiveApi; now?: number }): JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [cold, setCold] = useState<ColdClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = (): Promise<void> =>
    Promise.all([api.listNotifications(), api.listCold()]).then(([n, c]) => {
      setNotifications(n);
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

  if (loading) return <p>Loading alerts…</p>;

  return (
    <section aria-label="Alerts">
      <header className="tov-screenhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Alerts</h2>
          <div className="tov-screenmeta">{notifications.length} alert{notifications.length === 1 ? '' : 's'}</div>
        </div>
        <button onClick={() => void refresh()} disabled={scanning}>{scanning ? 'Rescanning…' : 'Rescan'}</button>
      </header>

      {notifications.length === 0 && cold.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Nothing needs you and no one has gone quiet. Tovira speaks rarely — this is what quiet looks like.</p>
      ) : notifications.length === 0 ? null : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li className="tov-stamp" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', paddingBottom: 4 }}>
            <span>Needs you</span><span>{String(notifications.length).padStart(2, '0')}</span>
          </li>
          {notifications.map((n) => (
            <li key={n.id} data-testid="alert" style={item}>
              <span className="tov-dot tov-dot--claret" aria-hidden="true" style={{ marginTop: 8 }} />
              <div>
                <strong>{n.title}</strong>
                <div style={{ color: 'var(--text-secondary)' }}>{n.body}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cold.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.25rem' }}>
          <li className="tov-stamp" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', paddingBottom: 4 }}>
            <span>Going quiet</span><span>{String(cold.length).padStart(2, '0')}</span>
          </li>
          {cold.map((c) => {
            const days = daysSince(c.lastTouchedAt, now);
            return (
              <li key={c.id} data-testid="cold-client" style={{ ...item, justifyContent: 'space-between' }}>
                <span>{c.name}</span>{' '}
                {/* Elapsed silence is a fact — the one place claret may dominate a row (§10). */}
                <span className="tov-mono" style={{ color: 'var(--claret)', fontSize: '0.85rem' }}>· silent {days} day{days === 1 ? '' : 's'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const item: React.CSSProperties = { display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.6rem 0', borderBottom: '1px solid var(--hairline)' };
