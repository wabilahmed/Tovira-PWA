import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import type { MoveSuggestion, MoveResult } from './noteMoveClient.js';
import type { ClientOption } from '../meetings/Meetings.js';

/** The subset of NoteMoveClient the suggestion prompt needs. */
export interface MoveSuggestApi {
  listMoveSuggestions(): Promise<MoveSuggestion[]>;
  move(noteId: string, toClientId: string): Promise<MoveResult | null>;
  undo(noteId: string, originalClientId: string): Promise<MoveResult | null>;
}

interface Toast { noteId: string; fromClientId: string; toClientName: string }

/**
 * [NOTE-MOVE] The misfile prompt. A note that reads like it belongs to another client rides the
 * confirmation queue as a soft "Filed under X: move it?" — never auto-applied, because a wrong move
 * is worse than a misfile. Move re-points the note and everything derived from it; Keep dismisses the
 * suggestion. After a move, an Undo toast REVERSES it (moves the note back) — undo restores, it never
 * deletes. Self-fetching and self-emptying: renders nothing when there is nothing to resolve.
 */
export function MoveSuggestions({ api, clients }: { api: MoveSuggestApi; clients: ClientOption[] }): JSX.Element | null {
  const [items, setItems] = useState<MoveSuggestion[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const nameOf = (id: string | null): string => clients.find((c) => c.id === id)?.name ?? 'another client';

  useEffect(() => {
    let live = true;
    void api.listMoveSuggestions().then((x) => { if (live) setItems(x); });
    return () => { live = false; };
  }, [api]);

  if (items.length === 0 && !toast) return null;

  const drop = (noteId: string): void => setItems((prev) => prev.filter((s) => s.noteId !== noteId));

  async function move(s: MoveSuggestion): Promise<void> {
    if (!s.toClientId) return;
    const result = await api.move(s.noteId, s.toClientId);
    if (!result?.ok) return;
    hapticTick(); // the note found its home — a commit
    drop(s.noteId);
    setToast({ noteId: s.noteId, fromClientId: s.fromClientId, toClientName: nameOf(s.toClientId) });
  }

  async function undo(t: Toast): Promise<void> {
    const result = await api.undo(t.noteId, t.fromClientId); // reverse move — restores, never deletes
    if (result?.ok) setToast(null);
  }

  return (
    <section aria-label="Misfiled notes" className="tov-move-suggestions">
      {items.map((s) => (
        <div key={s.noteId} data-testid="move-suggestion" style={box}>
          <p style={{ margin: '0 0 0.5rem' }}>
            Filed under <strong>{nameOf(s.fromClientId)}</strong>, but this looks like{' '}
            <strong>{s.toClientName ?? nameOf(s.toClientId)}</strong>. Move it?
            {s.reason && <small className="tov-stamp" style={{ display: 'block', color: 'var(--text-secondary)' }}>{s.reason}</small>}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => void move(s)} disabled={!s.toClientId}>Move</button>
            <button onClick={() => drop(s.noteId)}>Keep</button>
          </div>
        </div>
      ))}
      {toast && (
        <div role="status" data-testid="move-toast" style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <span>Moved to <strong>{toast.toClientName}</strong>.</span>
          <button onClick={() => void undo(toast)}>Undo</button>
        </div>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
