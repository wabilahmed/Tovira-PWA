import { useEffect, useState, useRef } from 'react';
import type { OpenPromise } from './promisesClient.js';
import { formatBody } from '../format/dates.js';
import { hapticTick } from '../haptics.js';
import { Page, PageHeader } from '../ui/PageHeader.js';

export interface PromisesApi {
  listOpen(): Promise<OpenPromise[]>;
  listConfirmations(): Promise<OpenPromise[]>;
  markDone(id: string): Promise<boolean>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
  editDueDate(id: string, dueDate: string | null): Promise<boolean>;
  /** [P20-2 / BOOK-09] Soft-delete + undo. */
  deletePromise(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
}

/** [P20-2 / BOOK-09] How long the "Promise deleted. Undo" toast stays before the delete is final (ms). */
const UNDO_WINDOW_MS = 10_000;

/** The open-promises tracker + confirmation queue (P4-1 / P1-7 / P2-3). */
export function PromisesTracker({ api, now = Date.now() }: { api: PromisesApi; now?: number }): JSX.Element {
  const [open, setOpen] = useState<OpenPromise[]>([]);
  const [pending, setPending] = useState<OpenPromise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStale, setShowStale] = useState(false); // [PROMISE-STALE] older promises sit behind a filter
  // [P20-2 / BOOK-09] the pending "Promise deleted. Undo" toast + its 10s window timer.
  const [undo, setUndo] = useState<{ p: OpenPromise; where: 'open' | 'pending' } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

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
    if (await api.markDone(id)) {
      hapticTick(); // promise kept
      setOpen((prev) => prev.filter((p) => p.id !== id));
    } else setError('Could not mark that done. Please try again.');
  }
  async function confirm(id: string): Promise<void> {
    if (await api.confirm(id)) {
      hapticTick(); // a guess became a fact — a commit
      setPending((prev) => prev.filter((p) => p.id !== id));
    }
  }
  async function reject(id: string): Promise<void> {
    if (await api.reject(id)) setPending((prev) => prev.filter((p) => p.id !== id));
  }
  // [AUDIT item 2] Correct a wrong due date in place (keeps the receipt).
  // [P18-6] Ignore an empty value — a cleared/half-typed field must not silently wipe the stored date.
  async function editDate(id: string, value: string): Promise<void> {
    if (!value) return;
    setError(null);
    if (await api.editDueDate(id, value)) setOpen((prev) => prev.map((p) => (p.id === id ? { ...p, dueDate: value } : p)));
    else setError('Could not update that date. Please try again.');
  }

  // [P20-2 / BOOK-09] Delete a promise (soft, undoable). Remove it from the list immediately and show
  // "Promise deleted. Undo" for 10s — the same pattern as the move-note toast. Undo restores it.
  async function del(p: OpenPromise, where: 'open' | 'pending'): Promise<void> {
    setError(null);
    if (where === 'open') setOpen((prev) => prev.filter((x) => x.id !== p.id));
    else setPending((prev) => prev.filter((x) => x.id !== p.id));
    const ok = await api.deletePromise(p.id);
    if (!ok) { // put it back; nothing was deleted
      if (where === 'open') setOpen((prev) => [p, ...prev]);
      else setPending((prev) => [p, ...prev]);
      setError('Could not delete that. Please try again.');
      return;
    }
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ p, where });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS); // window closes → delete is final
  }

  async function undoDelete(): Promise<void> {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const { p, where } = undo;
    setUndo(null);
    if (await api.restore(p.id)) {
      if (where === 'open') setOpen((prev) => [p, ...prev].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')));
      else setPending((prev) => [p, ...prev]);
    } else setError('Could not undo. Please reload.');
  }

  if (loading) return <Page testId="promises-page" label="Promises"><PageHeader title="Promises" /><p className="ui-secondary">Loading your promises…</p></Page>;

  // [PROMISE-STALE] Active = not stale (the foreground: count, claret, overdue). Stale (overdue past
  // the window) sits behind a filter — still listed and actionable, but never claret and never in the
  // active/overdue counts.
  const active = open.filter((p) => !p.stale);
  const stale = open.filter((p) => p.stale);
  const overdueCount = active.filter((p) => overdue(p, now)).length;

  return (
    <Page testId="promises-page" label="Promises">
      <PageHeader
        title="Promises"
        subtitle={<>
          {active.length} open
          {overdueCount > 0 && <> · {overdueCount} overdue</>}
          {pending.length > 0 && <> · {pending.length} to confirm</>}
          {stale.length > 0 && <> · {stale.length} older</>}
        </>}
      />
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}
      {undo && (
        <div role="status" data-testid="promise-undo" className="lead-toast">
          <span>Promise deleted.</span>
          <button onClick={() => void undoDelete()}>Undo</button>
        </div>
      )}
      {active.length === 0 && stale.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No open promises. You're all caught up.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {active.map((p) => (
            <li key={p.id} data-testid="open-promise" style={row}>
              <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                {overdue(p, now) && <span className="tov-dot tov-dot--claret" aria-hidden="true" />}
                <span>
                  {p.text} <small className="tov-stamp" style={overdue(p, now) ? { color: 'var(--claret)' } : undefined}>{due(p)}</small>
                </span>
              </span>
              <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <DueDateField label={`Due date for: ${p.text}`} stored={p.dueDate ?? ''} onConfirm={(v) => void editDate(p.id, v)} />
                <button onClick={() => void done(p.id)}>Done</button>
                <button aria-label={`Delete promise: ${p.text}`} onClick={() => void del(p, 'open')}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {stale.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button onClick={() => setShowStale((s) => !s)} aria-expanded={showStale} style={{ color: 'var(--text-secondary)' }}>
            {showStale ? 'Hide' : 'Show'} {stale.length} older promise{stale.length > 1 ? 's' : ''}
          </button>
          {showStale && (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {stale.map((p) => (
                <li key={p.id} data-testid="stale-promise" style={{ ...row, color: 'var(--text-secondary)' }}>
                  {/* stale: no claret, muted — still stored/searchable, still actionable */}
                  <span>{p.text} <small className="tov-stamp">{due(p)}</small></span>
                  <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button onClick={() => void done(p.id)}>Done</button>
                    <button aria-label={`Delete promise: ${p.text}`} onClick={() => void del(p, 'open')}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ color: 'var(--amber)' }}>To confirm (not yet facts)</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {pending.map((p) => (
              <li key={p.id} data-testid="pending-promise" style={row}>
                <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                  <span className="tov-dot tov-dot--amber" aria-hidden="true" />
                  {p.text}
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button onClick={() => void confirm(p.id)}>Confirm</button>
                  <button onClick={() => void reject(p.id)}>Reject</button>
                  <button aria-label={`Delete promise: ${p.text}`} onClick={() => void del(p, 'pending')}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

function due(p: OpenPromise): string {
  // [P18-4] Show the resolved date for action AND, when present, the raw phrase it came from for
  // provenance ("· due 5 Mar 2026 · from 'by Thursday'") — the rep can see what Tovira read it from.
  if (p.dueDate) {
    const base = `· due ${formatBody(p.dueDate)}`;
    return p.dueRaw ? `${base} · from “${p.dueRaw}”` : base;
  }
  if (p.dateStatus === 'to_confirm') return `· Date to confirm${p.dueRaw ? ` (“${p.dueRaw}”)` : ''}`; // [P40-1]
  if (p.dueRaw) return `· ${p.dueRaw}`;
  return '· no date';
}

/** A promise is overdue when its resolved due date is in the past. Elapsed time
 *  is a fact, so claret here passes the honesty rules (§10). */
function overdue(p: OpenPromise, now: number): boolean {
  if (!p.dueDate) return false;
  const t = Date.parse(p.dueDate);
  return Number.isFinite(t) && t < now;
}

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) 0',
  borderBottom: '1px solid var(--hairline)',
};

/** [P43-8 · owner] The date is saved when the rep confirms it (the picker closes / the field loses focus, or Enter),
 *  not on every picker change: adjusting it three times then confirming writes ONE edit record. Unchanged → nothing. */
function DueDateField({ label, stored, onConfirm }: { label: string; stored: string; onConfirm: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(stored);
  const sent = useRef<string | null>(null); // a second blur before the save lands never sends it again
  useEffect(() => { setDraft(stored); sent.current = null; }, [stored]);
  const confirm = (): void => { if (draft && draft !== stored && draft !== sent.current) { sent.current = draft; onConfirm(draft); } };
  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={confirm}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
