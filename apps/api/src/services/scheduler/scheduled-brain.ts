import type { AdvisoryLock, JobRunStore } from '../../ports/scheduled-jobs.js';

export interface BrainJob {
  /** Stable name, also the /health key and the job-run record key. */
  name: string;
  /** Postgres advisory-lock key — unique per job so jobs don't block each other. */
  lockKey: number;
  /** Minimum gap between runs, in ms (e.g. ~15s for the sweep, 24h for nightly). */
  intervalMs: number;
  run: () => Promise<void>;
}

export interface ScheduledBrainDeps {
  jobs: BrainJob[];
  lock: AdvisoryLock;
  store: JobRunStore;
  /** Injectable clock for tests. */
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Drives scheduled jobs in-process on a timer (SWEEP-NEVER-RUNS). Each tick, any job
 * whose interval has elapsed is run — but only after acquiring its advisory lock, so
 * under autoscaling exactly one task runs it. The due-check is repeated INSIDE the
 * lock to close the race where another task ran the job between our check and our
 * acquiring the lock. Every run (success or failure) is recorded so /health can show
 * the brain is actually alive. A job that throws is recorded as failed and never takes
 * down the tick or the other jobs.
 */
export class ScheduledBrain {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly log: (msg: string, err?: unknown) => void;

  constructor(
    private readonly deps: ScheduledBrainDeps,
    /** How often the brain wakes to check for due jobs. */
    private readonly tickMs = 30_000,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.log =
      deps.log ??
      ((m, e) => {
        console.warn(m, e ?? '');
      });
  }

  /** Begin ticking. Runs one pass immediately so a fresh boot doesn't wait a tick. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, this.tickMs);
    // Don't let the timer alone keep the process alive (the HTTP server does that).
    this.timer.unref?.();
    void this.runDue();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One pass: run every job that is due and lockable. Never throws. */
  async runDue(): Promise<void> {
    for (const job of this.deps.jobs) {
      try {
        const last = await this.deps.store.lastRunAt(job.name);
        if (last !== null && this.now() - last < job.intervalMs) continue; // not due
        await this.deps.lock.withLock(job.lockKey, async () => {
          // Re-check under the lock: another task may have just run it.
          const fresh = await this.deps.store.lastRunAt(job.name);
          if (fresh !== null && this.now() - fresh < job.intervalMs) return;
          try {
            await job.run();
            await this.deps.store.record(job.name, { at: this.now(), ok: true, error: null });
          } catch (err) {
            this.log(`[brain] job ${job.name} failed`, err);
            await this.deps.store.record(job.name, {
              at: this.now(),
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      } catch (err) {
        // A lock/store transport error must not stop the other jobs or the timer.
        this.log(`[brain] tick error for ${job.name}`, err);
      }
    }
  }
}
