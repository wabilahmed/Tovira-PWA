/**
 * Server-side note sweep (FLOWS-7). The capture pipeline is normally advanced by
 * the app, but a rep who never reopens a client would leave a voice note stuck at
 * pending_transcription forever. This scheduled job advances every rep's stuck
 * notes — bounded: after `maxAttempts` it marks the note needs_review (a terminal
 * flagged state) rather than retrying endlessly or silently dropping it. "Never
 * lose a recording" holds — the note is either advanced or honestly flagged.
 */
export interface SweepableNote {
  id: string;
  status: string;
  sweepAttempts: number;
}

export interface NoteSweepDeps {
  allUserIds(): Promise<string[]>;
  listPending(userId: string): Promise<SweepableNote[]>;
  transcribe(userId: string, noteId: string): Promise<void>;
  extract(userId: string, noteId: string, todayIso: string): Promise<void>;
  setAttempts(userId: string, noteId: string, attempts: number): Promise<void>;
  markNeedsReview(userId: string, noteId: string): Promise<void>;
  /** [SPEND-CAP] Optional over-cap gate. A capped rep's pending notes are LEFT UNTOUCHED (not
   *  advanced, not attempt-counted, never flagged) so they resume intact once the rep is under
   *  cap — a spend cap must never burn a note's retry budget or push it to needs_review. */
  canSpend?(userId: string): Promise<boolean>;
  /** [IMPORT-DONE] Optional: called once when a note reaches a TERMINAL state (extracted /
   *  needs_review) via the sweep, so an import completion can notify the waiting rep. Best-effort —
   *  a failure here never affects the sweep. Fires once because a terminal note is never re-listed. */
  onSettled?(userId: string, noteId: string): Promise<void>;
}

export interface SweepResult {
  advanced: number;
  flagged: number;
}

export const DEFAULT_MAX_SWEEP_ATTEMPTS = 5;

export class NoteSweepService {
  constructor(
    private readonly deps: NoteSweepDeps,
    private readonly maxAttempts: number = DEFAULT_MAX_SWEEP_ATTEMPTS,
  ) {}

  async sweep(todayIso: string): Promise<SweepResult> {
    let advanced = 0;
    let flagged = 0;
    for (const userId of await this.deps.allUserIds()) {
      // [SPEND-CAP] A capped rep's queue waits, untouched — no attempt bump, no needs_review.
      if (this.deps.canSpend && !(await this.deps.canSpend(userId))) continue;
      for (const note of await this.deps.listPending(userId)) {
        // Exhausted retries → terminal flagged state, never silently dropped.
        if (note.sweepAttempts >= this.maxAttempts) {
          await this.deps.markNeedsReview(userId, note.id);
          flagged += 1;
          await this.settle(userId, note.id); // [IMPORT-DONE] a stuck import notifies failure
          continue;
        }
        // Count this attempt before trying, so a step that keeps throwing still
        // converges to needs_review instead of retrying forever.
        await this.deps.setAttempts(userId, note.id, note.sweepAttempts + 1);
        try {
          if (note.status === 'pending_transcription') {
            await this.deps.transcribe(userId, note.id); // → pending_extraction (not terminal, no settle)
          } else if (note.status === 'pending_extraction') {
            await this.deps.extract(userId, note.id, todayIso); // → extracted | needs_review (terminal)
            await this.settle(userId, note.id); // [IMPORT-DONE] notify on import completion
          }
          advanced += 1;
        } catch {
          // Leave it pending; the next sweep retries (attempts already bumped).
        }
      }
    }
    return { advanced, flagged };
  }

  /** [IMPORT-DONE] Fire the settled hook — best-effort, isolated: a notification failure must never
   *  break the sweep or a note's advance. */
  private async settle(userId: string, noteId: string): Promise<void> {
    if (!this.deps.onSettled) return;
    try {
      await this.deps.onSettled(userId, noteId);
    } catch {
      // A notify failure is not a sweep failure — the note is already advanced/flagged.
    }
  }
}
