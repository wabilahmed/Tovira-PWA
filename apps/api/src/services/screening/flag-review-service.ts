import type { NoteRepository } from '../../ports/note-repository.js';
import { groupHeldFlags, restoreFlags, type FlagReview, type RestoreSelector } from './flag-review.js';

/**
 * [SCREEN-REVIEW] Receives one aggregate restore signal per flag a rep clears: category + span ONLY.
 * Never message content, names, or note/client references, and not attributable to a rep or their book.
 */
export interface FlagRestoreSignalSink {
  record(category: string, span: string): Promise<void> | void;
}

/**
 * Orchestrates the flag-review surface: list a note's held flags, and restore selected ones. Restoring
 * flips excluded=false (the ONLY thing that clears it — fail-closed) and RE-QUEUES the note for extraction
 * so the sweep re-extracts it, now including the restored messages (as proven in Task 3). Each cleared
 * flag is emitted to the aggregate signal sink.
 */
export class FlagReviewService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly signals?: FlagRestoreSignalSink,
  ) {}

  async review(userId: string, noteId: string): Promise<FlagReview | null> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return null;
    return groupHeldFlags(note.messages ?? []);
  }

  async restore(userId: string, noteId: string, sel: RestoreSelector): Promise<{ restored: number; status: string } | null> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return null;
    const r = restoreFlags(note.messages ?? [], sel);
    if (r.restored === 0) return { restored: 0, status: note.status };
    // Re-queue: the sweep re-extracts the note, now including the restored messages (sweepAttempts reset
    // so a note that previously exhausted its retries still re-runs).
    await this.notes.update(userId, noteId, { messages: r.messages, status: 'pending_extraction', sweepAttempts: 0 });
    for (const s of r.signals) await this.signals?.record(s.category, s.span);
    return { restored: r.restored, status: 'pending_extraction' };
  }
}
