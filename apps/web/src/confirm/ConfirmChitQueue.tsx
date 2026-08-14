import { useEffect, useState } from 'react';
import type { OpenPromise } from '../promises/promisesClient.js';
import { ConfirmChit } from './ConfirmChit.js';

/** The subset of the promises client the confirmation queue needs. */
export interface ConfirmQueueApi {
  listConfirmations(): Promise<OpenPromise[]>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
}

/**
 * The confirmation queue, surfaced inline wherever the rep lands — Today, Alerts,
 * the Monday Statement. Self-fetching and self-emptying: it renders nothing when
 * there is nothing to confirm, so a clean queue leaves no trace. Confirm turns a
 * guess into a fact; Not right removes it — a wrong fact is worse than a missing
 * one.
 */
export function ConfirmChitQueue({ api, heading = 'To confirm' }: { api: ConfirmQueueApi; heading?: string }): JSX.Element | null {
  const [items, setItems] = useState<OpenPromise[]>([]);

  useEffect(() => {
    let live = true;
    void api.listConfirmations().then((x) => {
      if (live) setItems(x);
    });
    return () => {
      live = false;
    };
  }, [api]);

  if (items.length === 0) return null;

  const drop = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  async function confirm(id: string): Promise<void> {
    if (await api.confirm(id)) drop(id);
  }
  async function reject(id: string): Promise<void> {
    if (await api.reject(id)) drop(id);
  }

  return (
    <section aria-label="To confirm" className="tov-confirm-queue">
      <h3 className="tov-stamp" style={{ color: 'var(--amber)' }}>
        {heading} · <span className="tov-mono">{items.length}</span>
      </h3>
      {items.map((p) => (
        <ConfirmChit
          key={p.id}
          text={p.text}
          onConfirm={() => void confirm(p.id)}
          onReject={() => void reject(p.id)}
        />
      ))}
    </section>
  );
}
