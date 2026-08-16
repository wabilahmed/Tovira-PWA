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
      for (const note of await this.deps.listPending(userId)) {
        // Exhausted retries → terminal flagged state, never silently dropped.
        if (note.sweepAttempts >= this.maxAttempts) {
          await this.deps.markNeedsReview(userId, note.id);
          flagged += 1;
          continue;
        }
        // Count this attempt before trying, so a step that keeps throwing still
        // converges to needs_review instead of retrying forever.
        await this.deps.setAttempts(userId, note.id, note.sweepAttempts + 1);
        try {
          if (note.status === 'pending_transcription') await this.deps.transcribe(userId, note.id);
          else if (note.status === 'pending_extraction') await this.deps.extract(userId, note.id, todayIso);
          advanced += 1;
        } catch {
          // Leave it pending; the next sweep retries (attempts already bumped).
        }
      }
    }
    return { advanced, flagged };
  }
}
