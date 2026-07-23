import { useEffect, useState } from 'react';
import type { OpenPromise } from './promisesClient.js';

export interface PromisesApi {
  listOpen(): Promise<OpenPromise[]>;
  listConfirmations(): Promise<OpenPromise[]>;
  markDone(id: string): Promise<boolean>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
}

/** The open-promises tracker + confirmation queue (P4-1 / P1-7 / P2-3). */
export function PromisesTracker({ api }: { api: PromisesApi }): JSX.Element {
  const [open, setOpen] = useState<OpenPromise[]>([]);
  const [pending, setPending] = useState<OpenPromise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([api.listOpen(), api.listConfirmations()]).then(([o, p]) => {
      if (!live) return;
      setOpen(o);
      setPending(p);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [api]);

  async function done(id: string): Promise<void> {
    setError(null);
    if (await api.markDone(id)) setOpen((prev) => prev.filter((p) => p.id !== id));
    else setError('Could not mark that done — please try again.');
  }
  async function confirm(id: string): Promise<void> {
    if (await api.confirm(id)) setPending((prev) => prev.filter((p) => p.id !== id));
  }
  async function reject(id: string): Promise<void> {
    if (await api.reject(id)) setPending((prev) => prev.filter((p) => p.id !== id));
  }

  if (loading) return <p>Loading your promises…</p>;

  return (
    <section aria-label="Promises">
      <h2 style={{ marginTop: 0 }}>Open promises</h2>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {open.length === 0 ? (
        <p style={{ color: '#666' }}>No open promises — you're all caught up.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {open.map((p) => (
            <li key={p.id} data-testid="open-promise" style={row}>
              <span>
                {p.text} <small style={{ color: '#888' }}>{due(p)}</small>
              </span>
              <button onClick={() => void done(p.id)}>Done</button>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ color: '#92400e' }}>To confirm (not yet facts)</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {pending.map((p) => (
              <li key={p.id} data-testid="pending-promise" style={row}>
                <span>{p.text}</span>
                <span style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => void confirm(p.id)}>Confirm</button>
                  <button onClick={() => void reject(p.id)}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function due(p: OpenPromise): string {
  if (p.dueDate) return `· due ${p.dueDate}`;
  if (p.dueRaw) return `· ${p.dueRaw}`;
  return '· no date';
}

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0',
  borderBottom: '1px solid #eee',
};
