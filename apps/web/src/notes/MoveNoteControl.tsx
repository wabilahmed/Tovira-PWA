import { hapticTick } from '../haptics.js';
import { useState } from 'react';
import type { MovePreview, MoveResult } from './noteMoveClient.js';
import type { ClientOption } from '../meetings/Meetings.js';

/** The subset of NoteMoveClient the per-note move control needs. */
export interface MoveNoteApi {
  preview(noteId: string): Promise<MovePreview | null>;
  move(noteId: string, toClientId: string): Promise<MoveResult | null>;
  undo(noteId: string, originalClientId: string): Promise<MoveResult | null>;
}

/**
 * [NOTE-MOVE] Per-note "Move to another client". The rep picks a target, sees EXACTLY what will move
 * (a known set of counts — a wrong move is worse than a misfile), then confirms. After the move an
 * Undo toast REVERSES it (moves the note back to where it was), restoring facts and pointers — it
 * never calls the destructive import-undo. `onMoved` lets the surrounding list drop the note.
 */
export function MoveNoteControl({ api, noteId, fromClientId, clients, onMoved }: {
  api: MoveNoteApi;
  noteId: string;
  fromClientId: string;
  clients: ClientOption[];
  onMoved?: (noteId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [moved, setMoved] = useState(false);
  const targets = clients.filter((c) => c.id !== fromClientId); // never "move" to the same client
  const nameOf = (id: string): string => clients.find((c) => c.id === id)?.name ?? 'another client';

  async function choose(id: string): Promise<void> {
    setTarget(id);
    setPreview(id ? await api.preview(noteId) : null);
  }

  function cancel(): void {
    setOpen(false);
    setTarget('');
    setPreview(null);
  }

  async function confirm(): Promise<void> {
    if (!target) return;
    const result = await api.move(noteId, target);
    if (!result?.ok) return;
    hapticTick();
    setOpen(false);
    setPreview(null);
    setMoved(true);
    onMoved?.(noteId);
  }

  async function undo(): Promise<void> {
    const result = await api.undo(noteId, fromClientId); // reverse move — restores, never deletes
    if (result?.ok) setMoved(false);
  }

  if (moved) {
    return (
      <div role="status" data-testid="move-note-toast" style={{ marginTop: 6, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <small className="tov-stamp">Moved to {nameOf(target)}.</small>
        <button onClick={() => void undo()}>Undo</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="tov-link" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>Move to another client</button>
    );
  }

  const c = preview?.counts;
  return (
    <div style={{ marginTop: 6 }}>
      <label>
        Move this note to{' '}
        <select value={target} onChange={(e) => void choose(e.target.value)} aria-label="Move this note to">
          <option value="">Choose a client…</option>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {c && (
        <div data-testid="move-note-preview" style={{ marginTop: 6 }}>
          <small className="tov-stamp">
            Moves {c.messages} messages, {c.promises} promises, {c.keyDates} key dates, {c.meetings} meetings,{' '}
            {c.people} people and {c.requirements} requirements to <strong>{nameOf(target)}</strong>.
          </small>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: 6 }}>
            <button onClick={() => void confirm()}>Confirm move</button>
            <button onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {!c && (
        <div style={{ marginTop: 6 }}>
          <button onClick={cancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
