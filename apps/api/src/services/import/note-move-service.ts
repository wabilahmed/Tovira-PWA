import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteMoveAuditRepository, NoteMoveCounts } from '../../ports/note-move-audit-repository.js';

/**
 * [NOTE-MOVE / IMPORT-UNDO] Move a misfiled note (and EVERYTHING derived from it) to the right
 * client, or undo an import entirely. This is the part that actually fixes a misfile.
 *
 * A move carries: the note itself (rawText, messages and embedding re-point — the content is
 * unchanged, so we never re-embed), its spine rows (promises + key dates), and its meeting(s). The
 * rest of the extraction — people, personal facts, concerns, next steps, requirements, unanswered
 * questions — lives in the note's `extracted` JSONB, so it moves WITH the note by construction;
 * likewise confirmation-queue items and the move-suggestion, which are derived on read. State is
 * preserved (a done promise stays done, a confirmed fact stays confirmed) because only `clientId`
 * changes. Last-contact is RECOMPUTED on BOTH clients — the misfile wrongly reset the wrong
 * client's going-cold clock while the right client silently cooled. Corpus counts are derived on
 * read, so both recompute automatically. Every move/undo is recorded in the audit trail.
 *
 * Atomicity: in production these mutations MUST run inside a single DB transaction (one rep, both
 * clients, enforced by RLS + the composite (user_id, client_id) FKs) so a partial move is
 * impossible. The service groups them for exactly that wrapping; the in-memory suite asserts the
 * end state. Tenant isolation holds throughout — every repo call is user-scoped and a note can
 * only move between two clients of the same rep (both are looked up under the same userId).
 */
export interface MovePreview {
  noteId: string;
  fromClientId: string;
  counts: NoteMoveCounts & { people: number; requirements: number };
}

export type MoveResult =
  | { ok: true; counts: NoteMoveCounts }
  | { ok: false; error: 'note_not_found' | 'target_not_found' | 'same_client' };

export type UndoResult = { ok: true; counts: NoteMoveCounts } | { ok: false; error: 'note_not_found' };

export class NoteMoveService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly meetings: MeetingRepository | undefined,
    private readonly clients: ClientRepository,
    private readonly audit: NoteMoveAuditRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private extractedCounts(extracted: unknown): { people: number; requirements: number } {
    const ex = extracted as { people?: unknown[]; requirements?: unknown[] } | null;
    return { people: ex?.people?.length ?? 0, requirements: ex?.requirements?.length ?? 0 };
  }

  /** What a move/undo will carry — shown to the rep before they confirm. */
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

  /** Recompute a client's last-contact from the notes it still owns (or its own creation time when
   *  it has none) — so the going-cold clock reflects reality after a note leaves or arrives. */
  private async recomputeLastContact(userId: string, clientId: string): Promise<void> {
    const notes = await this.notes.listByClient(userId, clientId);
    const latest = notes.reduce((max, n) => Math.max(max, n.createdAt), 0);
    const client = await this.clients.findByIdForUser(userId, clientId);
    await this.clients.setLastTouched(userId, clientId, latest > 0 ? latest : client?.createdAt ?? this.now());
  }

  async move(userId: string, noteId: string, toClientId: string): Promise<MoveResult> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { ok: false, error: 'note_not_found' };
    if (note.clientId === toClientId) return { ok: false, error: 'same_client' };
    const target = await this.clients.findByIdForUser(userId, toClientId);
    if (!target) return { ok: false, error: 'target_not_found' };
    const fromClientId = note.clientId;

    // Re-point the derived rows, then the note itself. (Prod: one transaction — see class doc.)
    const spine = await this.facts.reassignNote(userId, noteId, toClientId);
    const meetings = this.meetings ? await this.meetings.reassignByNote(userId, noteId, toClientId) : 0;
    // Move the note; clear any move-suggestion (it is now resolved). Embedding is left in place —
    // the content did not change, so we re-point rather than re-embed.
    await this.notes.update(userId, noteId, { clientId: toClientId, moveSuggestion: null });

    await this.recomputeLastContact(userId, fromClientId);
    await this.recomputeLastContact(userId, toClientId);

    const counts: NoteMoveCounts = { messages: note.messages?.length ?? 0, promises: spine.promises, keyDates: spine.keyDates, meetings };
    await this.audit.record(userId, { noteId, kind: 'move', fromClientId, toClientId, counts });
    return { ok: true, counts };
  }

  async undo(userId: string, noteId: string): Promise<UndoResult> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { ok: false, error: 'note_not_found' }; // already undone → idempotent no-op
    const fromClientId = note.clientId;

    const spine = await this.facts.deleteByNote(userId, noteId);
    const meetings = this.meetings ? await this.meetings.deleteByNote(userId, noteId) : 0;
    const counts: NoteMoveCounts = { messages: note.messages?.length ?? 0, promises: spine.promises, keyDates: spine.keyDates, meetings };
    // Delete the note LAST. The extraction/training log survives (migration 0045) — a reverted
    // import is genuine data about what the extractor produced (same rule as a rejected pending note).
    await this.notes.delete(userId, noteId);
    await this.recomputeLastContact(userId, fromClientId);
    await this.audit.record(userId, { noteId, kind: 'undo', fromClientId, toClientId: null, counts });
    return { ok: true, counts };
  }
}
