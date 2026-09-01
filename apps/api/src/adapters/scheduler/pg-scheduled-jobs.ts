import type { Pool } from 'pg';
import type { AdvisoryLock, JobRun, JobRunStore } from '../../ports/scheduled-jobs.js';

/**
 * Postgres last-run store (scheduled_job_runs, migration 0039). A SYSTEM table
 * (no RLS): the brain runs without a user session. Times are stored as timestamptz
 * and exchanged as epoch ms.
 */
export class PgJobRunStore implements JobRunStore {
  constructor(private readonly pool: Pool) {}

  async record(name: string, run: { at: number; ok: boolean; error?: string | null }): Promise<void> {
    await this.pool.query(
      `INSERT INTO scheduled_job_runs (job_name, last_run_at, last_ok, last_error)
       VALUES ($1, to_timestamp($2 / 1000.0), $3, $4)
       ON CONFLICT (job_name) DO UPDATE
         SET last_run_at = EXCLUDED.last_run_at,
             last_ok     = EXCLUDED.last_ok,
             last_error  = EXCLUDED.last_error`,
      [name, run.at, run.ok, run.error ?? null],
    );
  }

  async lastRunAt(name: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ ms: string }>(
      'SELECT (extract(epoch FROM last_run_at) * 1000)::bigint AS ms FROM scheduled_job_runs WHERE job_name = $1',
      [name],
    );
    return rows[0] ? Number(rows[0].ms) : null;
  }

  async list(): Promise<JobRun[]> {
    const { rows } = await this.pool.query<{ job_name: string; ms: string; last_ok: boolean; last_error: string | null }>(
      `SELECT job_name, (extract(epoch FROM last_run_at) * 1000)::bigint AS ms, last_ok, last_error
       FROM scheduled_job_runs ORDER BY job_name`,
    );
    return rows.map((r) => ({ name: r.job_name, lastRunAt: Number(r.ms), ok: r.last_ok, error: r.last_error }));
  }
}

/**
 * Postgres SESSION-scoped advisory lock. pg_try_advisory_lock is non-blocking (returns
 * false if another session holds the key) and the lock lives on the connection — so if
 * the task crashes mid-job, the connection drops and Postgres releases the lock
 * automatically. We hold ONE pooled client for the duration of `fn` (the job uses its
 * own pool connections) and unlock + release it after.
 */
export class PgAdvisoryLock implements AdvisoryLock {
  constructor(private readonly pool: Pool) {}

  async withLock(key: number, fn: () => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
      if (!rows[0]?.locked) return false; // held by another task → skip
      try {
        await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {
          /* the connection may be dying; the session lock releases with it */
        });
      }
      return true;
    } finally {
      client.release();
    }
  }
}
