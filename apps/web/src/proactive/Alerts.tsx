import { useEffect, useState } from 'react';
import type { ColdClient, Notification } from './proactiveClient.js';

export interface ProactiveApi {
  listCold(): Promise<ColdClient[]>;
  listNotifications(): Promise<Notification[]>;
  runScan(): Promise<boolean>;
}

/** In-app alerts + going-cold list — value even when push fails/is off (P3-5). */
export function Alerts({ api }: { api: ProactiveApi }): JSX.Element {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Alerts</h2>
        <button onClick={() => void refresh()} disabled={scanning}>{scanning ? 'Checking…' : 'Refresh'}</button>
      </div>

      {notifications.length === 0 ? (
        <p style={{ color: '#666' }}>No alerts right now.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notifications.map((n) => (
            <li key={n.id} data-testid="alert" style={item}>
              <strong>{n.title}</strong>
              <div style={{ color: '#555' }}>{n.body}</div>
            </li>
          ))}
        </ul>
      )}

      <h2>Going quiet</h2>
      {cold.length === 0 ? (
        <p style={{ color: '#666' }}>No clients have gone cold.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {cold.map((c) => (
            <li key={c.id} data-testid="cold-client" style={item}>
              {c.name} <small style={{ color: '#888' }}>· last contact {new Date(c.lastTouchedAt).toLocaleDateString()}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const item: React.CSSProperties = { padding: '0.5rem 0', borderBottom: '1px solid #eee' };
