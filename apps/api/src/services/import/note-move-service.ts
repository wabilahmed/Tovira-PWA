import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { NoteMoveCounts } from '../../ports/note-move-audit-repository.js';
import type { NoteMoveTx, MoveOutcome, UndoOutcome } from '../../ports/note-move-tx.js';

/**
 * [NOTE-MOVE / IMPORT-UNDO] Move a misfiled note (and EVERYTHING derived from it) to the right
 * client, or undo an import entirely. This is the part that actually fixes a misfile.
 *
 * A move carries: the note itself (rawText, messages and embedding re-point — the content is
 * unchanged, so we never re-embed), its spine rows (promises + key dates), and its meeting(s). The
 * rest of the extraction — people, personal facts, concerns, next steps, requirements, unanswered
 * questions — lives in the note's `extracted` JSONB, so it moves WITH the note by construction;
 * likewise confirmation-queue items and the move-suggestion, derived on read. State is preserved (a
 * done promise stays done, a confirmed fact stays confirmed) because only `clientId` changes.
 * Last-contact is RECOMPUTED on BOTH clients — the misfile wrongly reset the wrong client's
 * going-cold clock while the right client silently cooled. Corpus counts are derived on read, so
 * both recompute automatically. Every move/undo is recorded in the audit trail.
 *
 * ATOMICITY (MOVE-ATOMIC, B1): the actual mutation — note, derived rows, both clients' last-contact
 * and the audit insert — is delegated to a `NoteMoveTx`, which runs it as ONE transaction (Postgres)
 * or a snapshot-restore (the in-memory double). A partial move is impossible: a fault partway
 * through leaves nothing changed on either client. This service adds the read-only PREVIEW shown to
 * the rep before they confirm. Tenant isolation holds throughout — a note can only move between two
 * clients of the same rep (enforced by the tx under `withTenant` + composite FKs).
 */
export interface MovePreview {
  noteId: string;
  fromClientId: string;
  counts: NoteMoveCounts & { people: number };
}

export type MoveResult = MoveOutcome;
export type UndoResult = UndoOutcome;

export class NoteMoveService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly meetings: MeetingRepository | undefined,
    private readonly tx: NoteMoveTx,
  ) {}

  private extractedCounts(extracted: unknown): { people: number; requirements: number } {
    const ex = extracted as { people?: unknown[]; requirements?: unknown[] } | null;
    return { people: ex?.people?.length ?? 0, requirements: ex?.requirements?.length ?? 0 };
  }

  /** What a move/undo will carry — shown to the rep before they confirm. Read-only. */
  async preview(userId: string, noteId: string): Promise<MovePreview | null> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return null;
    const promises = await this.facts.listPromisesByNote(userId, noteId);
    const keyDates = await this.facts.listKeyDatesByNote(userId, noteId);
    const meeting = this.meetings ? await this.meetings.findByNoteId(userId, noteId) : null;
    return {
      noteId,
      fromClientId: note.clientId,
      counts: {
        messages: note.messages?.length ?? 0,
        promises: promises.length,
        keyDates: keyDates.length,
        meetings: meeting ? 1 : 0,
        ...this.extractedCounts(note.extracted),
      },
    };
  }

  move(userId: string, noteId: string, toClientId: string): Promise<MoveResult> {
    return this.tx.move(userId, noteId, toClientId);
  }

  undo(userId: string, noteId: string): Promise<UndoResult> {
    return this.tx.undo(userId, noteId);
  }
}
