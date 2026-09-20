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
  /** [TRIAL-FARM] Optional verification gate. An unverified rep's pending notes are LEFT UNTOUCHED
   *  (not advanced, not attempt-counted, never flagged) — exactly like the spend cap — so they resume
   *  intact the moment the rep verifies. Extraction is the one paid operation gated on verification. */
  isVerified?(userId: string): Promise<boolean>;
  /** [ASYNC-EXTRACT] Optional extraction-ceiling gate. A rep at their trial/paid ceiling has their
   *  queue LEFT UNTOUCHED (same skip as spend-cap/verification) — NOT attempt-counted, never pushed to
   *  needs_review. Before this, a ceiling-deferred note (trial_limit) was re-swept until it hit
   *  maxAttempts and was mislabeled needs_review, losing a trial rep their book. Waits, resumes when
   *  the ceiling lifts (next period / on subscribe). */
  allow?(userId: string): Promise<boolean>;
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
export const DEFAULT_SWEEP_CONCURRENCY = 1;

export class NoteSweepService {
  constructor(
    private readonly deps: NoteSweepDeps,
    private readonly maxAttempts: number = DEFAULT_MAX_SWEEP_ATTEMPTS,
    /** [ASYNC-EXTRACT] How many notes to process at once. The sweep is the PRIMARY extraction path
     *  now, so it must not be strictly serial. Bounded so it never exceeds the model provider's rate
     *  limit or a container's headroom. Default 1 keeps the old serial behaviour for callers that
     *  don't opt in. */
    private readonly concurrency: number = DEFAULT_SWEEP_CONCURRENCY,
  ) {}

  /**
   * One pass. [ASYNC-EXTRACT] Fairness across accounts beats raw throughput: eligible notes are
   * interleaved ROUND-ROBIN (one per rep per column) and drained by a bounded pool, so one rep's big
   * book never starves another rep's single note — the small note is in column 0 and starts in the
   * first cycle. Per-user skips (spend-cap / verification / ceiling) drop a whole rep's queue before
   * interleaving, leaving it untouched. Idempotent: each note appears once per pass, and a terminal
   * note is never re-listed, so no note is extracted twice.
   */
  async sweep(todayIso: string): Promise<SweepResult> {
    // Gather each eligible rep's pending notes (apply the per-user skips ONCE, up front).
    const perUser: Array<{ userId: string; notes: SweepableNote[] }> = [];
    for (const userId of await this.deps.allUserIds()) {
      // [SPEND-CAP] capped, [TRIAL-FARM] unverified, [ASYNC-EXTRACT] over the extraction ceiling —
      // each leaves the rep's queue untouched (no attempt bump, no needs_review), to resume intact.
      if (this.deps.canSpend && !(await this.deps.canSpend(userId))) continue;
      if (this.deps.isVerified && !(await this.deps.isVerified(userId))) continue;
      if (this.deps.allow && !(await this.deps.allow(userId))) continue;
      const notes = await this.deps.listPending(userId);
      if (notes.length > 0) perUser.push({ userId, notes });
    }
    // Round-robin interleave for fairness.
    const queue: Array<{ userId: string; note: SweepableNote }> = [];
    const maxLen = perUser.reduce((m, u) => Math.max(m, u.notes.length), 0);
    for (let col = 0; col < maxLen; col++) {
      for (const u of perUser) {
        const note = u.notes[col];
        if (note) queue.push({ userId: u.userId, note });
      }
    }

    let advanced = 0;
    let flagged = 0;
    let cursor = 0; // shared across workers; `queue[cursor++]` is atomic on the single JS thread
    const processOne = async (userId: string, note: SweepableNote): Promise<void> => {
      // Exhausted retries → terminal flagged state, never silently dropped.
      if (note.sweepAttempts >= this.maxAttempts) {
        await this.deps.markNeedsReview(userId, note.id);
        flagged += 1;
        await this.settle(userId, note.id);
        return;
      }
      // Count this attempt before trying, so a step that keeps throwing still converges to needs_review.
      await this.deps.setAttempts(userId, note.id, note.sweepAttempts + 1);
      try {
        if (note.status === 'pending_transcription') {
          await this.deps.transcribe(userId, note.id); // → pending_extraction (not terminal, no settle)
        } else if (note.status === 'pending_extraction') {
          await this.deps.extract(userId, note.id, todayIso); // → extracted | needs_review (terminal)
          await this.settle(userId, note.id);
        }
        advanced += 1;
      } catch {
        // Leave it pending; the next sweep retries (attempts already bumped).
      }
    };
    const worker = async (): Promise<void> => {
      for (;;) {
        const item = queue[cursor++];
        if (!item) return;
        await processOne(item.userId, item.note);
      }
    };
    const workers = Math.max(1, Math.min(this.concurrency, queue.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
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
