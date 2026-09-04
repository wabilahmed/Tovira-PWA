import type { NoteMoveCounts } from './note-move-audit-repository.js';

/**
 * Port: the ATOMIC note move / import undo (MOVE-ATOMIC, B1). A move rewrites which client owns a
 * note and everything derived from it, recomputes both clients' last-contact, and writes the audit
 * row — all of which must happen together or not at all. A partial move is worse than the misfile
 * it fixes: facts split across two clients with nothing indicating anything is wrong, after the rep
 * confirmed a specific set of counts. So this is one transaction (Postgres) or a snapshot-restore
 * (the in-memory test double), never a sequence of independently-committing writes.
 */
export type MoveOutcome =
  | { ok: true; fromClientId: string; counts: NoteMoveCounts }
  | { ok: false; error: 'note_not_found' | 'target_not_found' | 'same_client' };

export type UndoOutcome =
  | { ok: true; fromClientId: string; counts: NoteMoveCounts }
  | { ok: false; error: 'note_not_found' };

export interface NoteMoveTx {
  move(userId: string, noteId: string, toClientId: string): Promise<MoveOutcome>;
  undo(userId: string, noteId: string): Promise<UndoOutcome>;
}
