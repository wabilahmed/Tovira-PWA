/**
 * [BULK-IMPORT · Task 4 / RULING 2] Parallel per-chat extraction. The rep confirmed the review screen;
 * each confirmed chat is now extracted in its OWN model call (D1 — one chat, one call, never two in a
 * prompt; the chat-isolation guard enforces the request body).
 *
 * Allowance semantics (RULING 2):
 *   - The allowance check gates STARTING a chat only. `start(item)` — which persists the note and runs
 *     the extraction — is called only once the start-gate passes. Once a chat has started it ALWAYS
 *     finishes: its remaining calls (a retry) are never re-gated, so an account that hits its limit
 *     mid-batch still completes every in-flight chat. The overshoot is absorbed by the gate, not here.
 *   - A chat not yet started when the allowance is exhausted gets the TERMINAL status
 *     'failed_usage_limit'. Because start() is never called for it, its note is never created — its
 *     uploaded content is discarded, not stored. No pause, no auto-resume.
 *   - The kill switch (AI_PAUSED) also gates starting; a started chat's in-flight calls are stopped by
 *     the gate itself (it refuses every non-exempt call while paused).
 *
 * Cache warm-up: the first chat is started and awaited alone so its cache-write primes the prefix; the
 * rest then fan out and read the warm cache. Bounded concurrency = bulkConcurrency(sweepConcurrency),
 * one lane below the background sweep so a big import never starves the live capture path.
 */
import type { ExtractOutcome } from '../extraction/extraction-service.js';

export type ChatJobState = 'queued' | 'extracting' | 'done' | 'failed' | 'failed_usage_limit';

export interface ChatJob {
  key: string;
  /** Set once the chat has started and its note exists; absent for an unstarted (discarded) chat. */
  noteId?: string;
  state: ChatJobState;
}

export interface BulkExtractionDeps<I> {
  items: I[];
  /** Stable per-chat key for the job row (the file name). */
  keyOf: (item: I) => string;
  /** Persist the note and extract it — called ONLY once a chat passes the start-gate. Returns the new
   *  note id (so a started-then-failed chat still shows its stored note) and the extraction outcome. */
  start: (item: I) => Promise<{ noteId: string; outcome: ExtractOutcome }>;
  /** Allowance start-gate: true → do not START new chats (in-flight ones still finish). */
  isExhausted: () => Promise<boolean>;
  /** Kill switch: true → do not start new chats (in-flight calls are stopped by the gate). */
  isPaused?: () => Promise<boolean>;
  concurrency: number;
  onProgress?: (jobs: ChatJob[]) => void;
}

/**
 * [finding 4] The background sweep runs at config.sweepConcurrency (default 5). A bulk import must not
 * consume every lane, or a rep capturing a voice note mid-import waits behind the batch. Leave one lane
 * of headroom — never below 1.
 */
export function bulkConcurrency(sweepConcurrency: number): number {
  return Math.max(1, sweepConcurrency - 1);
}

/** Map an ExtractionService outcome status onto the rep-facing per-chat state (for a STARTED chat). */
export function chatStateFor(status: string): ChatJobState {
  switch (status) {
    case 'extracted':
    case 'pending_confirmation':
    case 'claimed_elsewhere': // the sweep won the claim — the note is being extracted, not failed
      return 'done';
    case 'spend_capped':
    case 'trial_limit':
      // A started chat should not hit the allowance (the gate absorbs its overshoot); if it still does,
      // surface it as the limit status rather than a generic failure.
      return 'failed_usage_limit';
    default:
      return 'failed'; // needs_review, not_found, verification_required, …
  }
}

export class BulkExtractionOrchestrator<I> {
  constructor(private readonly deps: BulkExtractionDeps<I>) {}

  async run(): Promise<ChatJob[]> {
    const { items, keyOf } = this.deps;
    const jobs: ChatJob[] = items.map((it) => ({ key: keyOf(it), state: 'queued' }));
    if (jobs.length === 0) return jobs;

    const processOne = async (item: I, job: ChatJob): Promise<void> => {
      // START-GATE (RULING 2): the only place the allowance / kill switch is checked. A chat that does
      // not pass is never started — start() is not called, so nothing is persisted (content discarded).
      if (this.deps.isPaused && (await this.deps.isPaused())) {
        job.state = 'failed';
        this.deps.onProgress?.(jobs);
        return;
      }
      if (await this.deps.isExhausted()) {
        job.state = 'failed_usage_limit';
        this.deps.onProgress?.(jobs);
        return;
      }
      job.state = 'extracting';
      this.deps.onProgress?.(jobs);
      // Past the gate: this chat is STARTED and always finishes — it is never re-gated for allowance.
      try {
        const { noteId, outcome } = await this.deps.start(item);
        job.noteId = noteId;
        job.state = chatStateFor(outcome.status);
      } catch {
        job.state = 'failed';
      }
      this.deps.onProgress?.(jobs);
    };

    // Warm-up: the first chat alone, awaited, so its cache-write primes the prefix for the rest.
    await processOne(items[0]!, jobs[0]!);

    // Fan out the remainder with a bounded worker pool (shared cursor on the single JS thread).
    let cursor = 1;
    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        await processOne(items[i]!, jobs[i]!);
      }
    };
    const lanes = Math.max(1, Math.min(this.deps.concurrency, items.length - 1));
    await Promise.all(Array.from({ length: lanes }, () => worker()));

    return jobs;
  }
}
