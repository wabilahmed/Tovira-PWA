import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import type { OpenPromise } from '../promises/promisesClient.js';
import { ConfirmChit } from './ConfirmChit.js';
import type { PendingCapture } from '../recall/recallClient.js';

/** The subset of the promises client the confirmation queue needs. */
export interface ConfirmQueueApi {
  listConfirmations(): Promise<OpenPromise[]>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
}

/** [P21-A3] Statements held from Ask ("Remember that …") — confirmed through the capture endpoints. */
export interface CaptureQueueApi {
  listCaptures(): Promise<PendingCapture[]>;
  confirmCapture(noteId: string): Promise<boolean>;
  rejectCapture(noteId: string): Promise<boolean>;
}

/**
 * The confirmation queue, surfaced inline wherever the rep lands — Today, Alerts,
 * the Monday Statement. Self-fetching and self-emptying: it renders nothing when
 * there is nothing to confirm, so a clean queue leaves no trace. Confirm turns a
 * guess into a fact; Not right removes it — a wrong fact is worse than a missing
 * one.
 */
export function ConfirmChitQueue({ api, heading = 'To confirm', captures }: { api: ConfirmQueueApi; heading?: string; captures?: CaptureQueueApi }): JSX.Element | null {
  const [items, setItems] = useState<OpenPromise[]>([]);
  const [held, setHeld] = useState<PendingCapture[]>([]);

  useEffect(() => {
    let live = true;
    void api.listConfirmations().then((x) => {
      if (live) setItems(x);
    });
    if (captures) void captures.listCaptures().then((x) => { if (live) setHeld(x); });
    return () => {
      live = false;
    };
  }, [api, captures]);

  if (items.length === 0 && held.length === 0) return null;

  const dropHeld = (noteId: string) => setHeld((prev) => prev.filter((c) => c.noteId !== noteId));
  async function resolveHeld(noteId: string, action: 'confirm' | 'reject'): Promise<void> {
    if (!captures) return;
    const ok = action === 'confirm' ? await captures.confirmCapture(noteId) : await captures.rejectCapture(noteId);
    if (ok) {
      if (action === 'confirm') hapticTick();
      dropHeld(noteId);
    }
  }

  const drop = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  async function confirm(id: string): Promise<void> {
    if (await api.confirm(id)) {
      hapticTick(); // a guess became a fact — a commit
      drop(id);
    }
  }
  async function reject(id: string): Promise<void> {
    if (await api.reject(id)) drop(id);
  }

  return (
    <section aria-label="To confirm" className="tov-confirm-queue">
      <h3 className="tov-stamp" style={{ color: 'var(--amber)' }}>
        {heading} · <span className="tov-mono">{items.length + held.length}</span>
      </h3>
      {held.map((c) => (
        <ConfirmChit
          key={`capture:${c.noteId}`}
          text={`${c.clientName} — ${c.summary ?? c.statement}`}
          onConfirm={() => void resolveHeld(c.noteId, 'confirm')}
          onReject={() => void resolveHeld(c.noteId, 'reject')}
        />
      ))}
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
