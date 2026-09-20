import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { ExtractionCounterRepository } from '../../ports/extraction-counter.js';

/**
 * [TRIAL-FARM] Durable extraction counter, RLS tenant-scoped. The app role is granted only
 * SELECT/INSERT/UPDATE (never DELETE), so the counter can ONLY ever increment — archival and
 * single-counterparty erasure cannot lower it. Full account deletion purges it via the users FK
 * `ON DELETE CASCADE` (owner-run, so it needs no app DELETE grant).
 */
export class PgExtractionCounter implements ExtractionCounterRepository {
  constructor(private readonly pool: Pool) {}

  async increment(userId: string, periodKey: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO extraction_counters (user_id, period_key, count) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, period_key) DO UPDATE SET count = extraction_counters.count + 1`,
        [userId, periodKey],
      );
    });
  }

  async count(userId: string, periodKey: string): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT count FROM extraction_counters WHERE user_id = $1 AND period_key = $2`,
        [userId, periodKey],
      );
      return rows.length ? Number((rows[0] as { count: number }).count) : 0;
    });
  }

  async purgeUser(): Promise<void> {
    // No-op: the users FK ON DELETE CASCADE purges this row on full account deletion. Explicit
    // deletion is intentionally NOT offered (the app role has no DELETE grant — the counter is
    // monotonic). Present so the port is satisfied uniformly with the in-memory adapter.
  }
}
