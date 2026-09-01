/**
 * Ports for the in-process "scheduled brain" (SWEEP-NEVER-RUNS).
 *
 * The API runs as a persistent Fargate task, so scheduled work (note sweep, nightly
 * priorities, trial emails) is driven by an in-process timer rather than the (stubbed)
 * EventBridge→Lambda path. Two concerns are pluggable so the runner is testable and
 * safe under autoscaling:
 *  - {@link AdvisoryLock}: only ONE task runs a given job at a time. Backed by a
 *    Postgres SESSION-scoped advisory lock, which the database releases automatically
 *    if the holding task dies mid-job (no stranded row-lock that stops all extraction).
 *  - {@link JobRunStore}: the last run of each job is recorded so liveness is
 *    checkable in /health — a scheduler that never fires looks exactly like one with
 *    nothing to do, and that is precisely how this bug survived a deploy.
 */

export interface JobRun {
  name: string;
  /** Epoch ms of the last completed run (success OR failure). */
  lastRunAt: number;
  /** Whether that last run finished without throwing. */
  ok: boolean;
  /** The failure message when ok is false; null on success. */
  error: string | null;
}

export interface JobRunStore {
  /** Upsert the last-run record for a job. */
  record(name: string, run: { at: number; ok: boolean; error?: string | null }): Promise<void>;
  /** Epoch ms of the job's last run, or null if it has never run. */
  lastRunAt(name: string): Promise<number | null>;
  /** Every job's last-run record (for the health signal). */
  list(): Promise<JobRun[]>;
}

export interface AdvisoryLock {
  /**
   * Run `fn` iff this caller acquires the lock for `key`; returns true if it ran,
   * false if the lock was already held elsewhere (another task) — in which case `fn`
   * is NOT run. The lock is held only for the duration of `fn` and released after,
   * and is session-scoped so a crash mid-`fn` releases it automatically.
   */
  withLock(key: number, fn: () => Promise<void>): Promise<boolean>;
}
