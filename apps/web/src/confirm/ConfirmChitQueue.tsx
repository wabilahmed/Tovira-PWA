import { hapticTick } from '../haptics.js';
import { useEffect, useRef, useState } from 'react';
import type { OpenPromise } from '../promises/promisesClient.js';
import { ConfirmChit } from './ConfirmChit.js';
import type { PendingCapture } from '../recall/recallClient.js';
import { Receipt } from '../components/Receipt.js';
import type { KeptSuggestion } from '../promises/promisesClient.js';

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

/** [P24-2] "Looks like you sent it — Mark done?" — a delivery seen in the chat; only the rep closes it. */
export interface KeptQueueApi {
  listKept(): Promise<KeptSuggestion[]>;
  markKeptDone(id: string): Promise<boolean>;
  undoKept(id: string): Promise<boolean>;
  notYetKept(id: string): Promise<boolean>;
}

/** How long the "Marked done. Undo" toast stays (same as Delete's undo window). */
const KEPT_UNDO_MS = 10_000;

/**
 * The confirmation queue, surfaced inline wherever the rep lands — Today, Alerts,
 * the Monday Statement. Self-fetching and self-emptying: it renders nothing when
 * there is nothing to confirm, so a clean queue leaves no trace. Confirm turns a
 * guess into a fact; Not right removes it — a wrong fact is worse than a missing
 * one.
 */
export function ConfirmChitQueue({ api, heading = 'To confirm', captures, kept }: { api: ConfirmQueueApi; heading?: string; captures?: CaptureQueueApi; kept?: KeptQueueApi }): JSX.Element | null {
  const [items, setItems] = useState<OpenPromise[]>([]);
  const [held, setHeld] = useState<PendingCapture[]>([]);
  const [looksSent, setLooksSent] = useState<KeptSuggestion[]>([]);
  const [undoKept, setUndoKept] = useState<KeptSuggestion | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  useEffect(() => {
    let live = true;
    void api.listConfirmations().then((x) => {
      if (live) setItems(x);
    });
    if (captures) void captures.listCaptures().then((x) => { if (live) setHeld(x); });
    if (kept) void kept.listKept().then((x) => { if (live) setLooksSent(x); });
    return () => {
      live = false;
    };
  }, [api, captures, kept]);

  // [P24-2] Mark done → closed now, undoable for 10s; Not yet → dismissed (no undo needed: nothing changed).
  async function markKept(s: KeptSuggestion): Promise<void> {
    if (!kept || !(await kept.markKeptDone(s.id))) return;
    hapticTick();
    setLooksSent((prev) => prev.filter((x) => x.id !== s.id));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoKept(s);
    undoTimer.current = setTimeout(() => setUndoKept(null), KEPT_UNDO_MS);
  }
  async function undoMarkKept(): Promise<void> {
    const s = undoKept;
    if (!kept || !s) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoKept(null);
    if (await kept.undoKept(s.id)) setLooksSent((prev) => [s, ...prev]);
  }
  async function notYet(s: KeptSuggestion): Promise<void> {
    if (kept && (await kept.notYetKept(s.id))) setLooksSent((prev) => prev.filter((x) => x.id !== s.id));
  }

  if (items.length === 0 && held.length === 0 && looksSent.length === 0 && !undoKept) return null;

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
        {heading} · <span className="tov-mono">{items.length + held.length + looksSent.length}</span>
      </h3>
      {undoKept && (
        <div role="status" data-testid="kept-undo" className="lead-toast">
          <span>Marked done.</span>
          <button onClick={() => void undoMarkKept()}>Undo</button>
        </div>
      )}
      {looksSent.map((s) => (
        <div key={`kept:${s.id}`} className="tov-confirm-chit" role="group" aria-label="Looks sent — confirm">
          <p className="tov-confirm-chit__text" style={{ margin: '0 0 0.4rem' }}><strong>{s.clientName}</strong> — <span>{s.message}</span></p>
          <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.5rem' }}>
            <Receipt quote={s.promise.quote} source="Promise" date={s.promise.date} />
            <Receipt quote={s.delivery.quote} source="Delivered" date={s.delivery.date} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="tov-link" onClick={() => void markKept(s)}>Mark done</button>
            <button className="tov-link" onClick={() => void notYet(s)}>Not yet</button>
          </div>
        </div>
      ))}
      {held.map((c) => (
        <ConfirmChit
          key={`capture:${c.noteId}`}
          who={c.clientName}
          text={c.summary ?? c.statement}
          onConfirm={() => void resolveHeld(c.noteId, 'confirm')}
          onReject={() => void resolveHeld(c.noteId, 'reject')}
        />
      ))}
      {items.map((p) => (
        <ConfirmChit
          key={p.id}
          text={p.text}
          // [P34-2] the client's name (or "Your note"); an older payload without clientName shows no lead.
          {...(p.clientName !== undefined ? { who: p.clientName ?? 'Your note', promised: p.owner === 'client' } : {})}
          onConfirm={() => void confirm(p.id)}
          onReject={() => void reject(p.id)}
        />
      ))}
    </section>
  );
}
