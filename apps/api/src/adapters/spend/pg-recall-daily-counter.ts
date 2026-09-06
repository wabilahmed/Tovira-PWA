import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { RecallDailyCounter } from '../../ports/recall-daily-counter.js';

/** Durable recall daily counter, RLS tenant-scoped (a rep's own count). */
export class PgRecallDailyCounter implements RecallDailyCounter {
  constructor(private readonly pool: Pool) {}

  async increment(userId: string, day: string): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO recall_daily (user_id, day, count) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET count = recall_daily.count + 1
         RETURNING count`,
        [userId, day],
      );
      return Number((rows[0] as { count: number }).count);
    });
  }
}
