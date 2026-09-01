import type { AdvisoryLock, JobRun, JobRunStore } from '../../ports/scheduled-jobs.js';

/** In-memory last-run store for tests and the local stack. */
export class InMemoryJobRunStore implements JobRunStore {
  private readonly runs = new Map<string, JobRun>();

  async record(name: string, run: { at: number; ok: boolean; error?: string | null }): Promise<void> {
    this.runs.set(name, { name, lastRunAt: run.at, ok: run.ok, error: run.error ?? null });
  }

  async lastRunAt(name: string): Promise<number | null> {
    return this.runs.get(name)?.lastRunAt ?? null;
  }

  async list(): Promise<JobRun[]> {
    return [...this.runs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * In-memory, non-blocking mutex mirroring pg_try_advisory_lock: if the key is already
 * held, withLock returns false immediately and does NOT run fn. Share one instance
 * between two brains in a test to simulate two tasks contending.
 */
export class InMemoryAdvisoryLock implements AdvisoryLock {
  private readonly held = new Set<number>();

  async withLock(key: number, fn: () => Promise<void>): Promise<boolean> {
    if (this.held.has(key)) return false;
    this.held.add(key);
    try {
      await fn();
    } finally {
      this.held.delete(key);
    }
    return true;
  }
}
