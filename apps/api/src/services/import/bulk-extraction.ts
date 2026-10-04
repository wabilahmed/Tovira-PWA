/**
 * [BULK-IMPORT · Task 4] Parallel per-chat extraction. After the rep confirms the review screen, each
 * confirmed chat is already persisted as its own note (status pending_extraction). This orchestrator
 * drives their extraction:
 *   - D1 one chat = one call: it never batches; it calls extractNote per note, each a single request
 *     (the chat-isolation guard enforces the request body separately).
 *   - Cache warm-up: it fires the FIRST chat alone and awaits it, so the cacheable system prefix is
 *     written once; the remaining chats then fan out and READ the warm cache rather than each paying a
 *     cold cache-write. (Nothing warms the cache today — finding 3 — so bulk must do it itself.)
 *   - Bounded concurrency: the fan-out runs at bulkConcurrency(sweepConcurrency), one lane below the
 *     background sweep so a big import never starves the live capture path.
 *   - One failure never fails the batch: a chat that throws or comes back needing review is marked
 *     failed; its neighbours still extract.
 *   - Stops at the allowance limit: before each call it checks the account allowance; once exhausted
 *     the remaining chats are marked paused_usage_limit (NOT errored) and never reach the model.
 */
import type { ExtractOutcome } from '../extraction/extraction-service.js';

export type ChatJobState = 'queued' | 'extracting' | 'done' | 'failed' | 'paused_usage_limit';

export interface ChatJob {
  noteId: string;
  state: ChatJobState;
}

export interface BulkExtractionDeps {
  /** Extract one persisted note (reuses the certified ExtractionService.extractNote). */
  extract: (userId: string, noteId: string, today: string) => Promise<ExtractOutcome>;
  /** Pre-call allowance check (AllowanceStatusService.isExhausted) — defer, don't burn a call. */
  isExhausted: (userId: string) => Promise<boolean>;
  /** Fan-out width. Derive with bulkConcurrency(config.sweepConcurrency). */
  concurrency: number;
  /** Optional progress callback, fired whenever a job changes state (in-app progress). */
  onProgress?: (jobs: ChatJob[]) => void;
}

/**
 * [finding 4] The background sweep runs at config.sweepConcurrency (default 5). A bulk import must not
 * consume every lane, or a rep capturing a voice note mid-import waits behind the batch. We leave one
 * lane of headroom — never below 1.
 */
export function bulkConcurrency(sweepConcurrency: number): number {
  return Math.max(1, sweepConcurrency - 1);
}

/** Map an ExtractionService outcome status onto the rep-facing per-chat state. */
export function chatStateFor(status: string): ChatJobState {
  switch (status) {
    case 'extracted':
    case 'pending_confirmation':
      return 'done';
    case 'spend_capped':
    case 'trial_limit':
      return 'paused_usage_limit';
    default:
      return 'failed'; // needs_review, not_found, verification_required, …
  }
}

export class BulkExtractionOrchestrator {
  constructor(private readonly deps: BulkExtractionDeps) {}

  async run(userId: string, noteIds: string[], today: string): Promise<ChatJob[]> {
    const jobs: ChatJob[] = noteIds.map((noteId) => ({ noteId, state: 'queued' }));
    if (jobs.length === 0) return jobs;

    const processOne = async (job: ChatJob): Promise<void> => {
      // Stop at the limit: a reservation the account can't afford is a pause, not a failure.
      if (await this.deps.isExhausted(userId)) {
        job.state = 'paused_usage_limit';
        this.deps.onProgress?.(jobs);
        return;
      }
      job.state = 'extracting';
      this.deps.onProgress?.(jobs);
      try {
        const outcome = await this.deps.extract(userId, job.noteId, today);
        job.state = chatStateFor(outcome.status);
      } catch {
        job.state = 'failed'; // one chat's failure is contained to its own row
      }
      this.deps.onProgress?.(jobs);
    };

    // Warm-up: the first chat alone, awaited, so its cache-write primes the prefix for the rest.
    await processOne(jobs[0]!);

    // Fan out the remainder with a bounded worker pool (shared cursor on the single JS thread).
    const rest = jobs.slice(1);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rest.length) {
        const job = rest[cursor]!;
        cursor += 1;
        await processOne(job);
      }
    };
    const lanes = Math.max(1, Math.min(this.deps.concurrency, rest.length));
    await Promise.all(Array.from({ length: lanes }, () => worker()));

    return jobs;
  }
}
