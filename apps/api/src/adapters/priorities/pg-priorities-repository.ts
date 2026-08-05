import type { Pool } from 'pg';
import type { PrioritiesRecord, PrioritiesRepository } from '../../ports/priorities-repository.js';
import type { TodayAction } from '../../services/hero/hero-service.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  user_id: string;
  day: Date;
  actions: TodayAction[];
  refresh_count: number;
  computed_at: Date;
}

export class PgPrioritiesRepository implements PrioritiesRepository {
  constructor(private readonly pool: Pool) {}

  async get(userId: string, day: string): Promise<PrioritiesRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT user_id, day, actions, refresh_count, computed_at
         FROM daily_priorities WHERE user_id = $1 AND day = $2`,
        [userId, day],
      );
      const r = (rows as unknown as Row[])[0];
      if (!r) return null;
      return {
        userId: r.user_id,
        day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
        actions: r.actions,
        refreshCount: r.refresh_count,
        computedAt: r.computed_at.getTime(),
      };
    });
  }

  async save(userId: string, day: string, actions: TodayAction[], refreshCount: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO daily_priorities (user_id, day, actions, refresh_count, computed_at)
         VALUES ($1, $2, $3::jsonb, $4, now())
         ON CONFLICT (user_id, day)
         DO UPDATE SET actions = EXCLUDED.actions, refresh_count = EXCLUDED.refresh_count, computed_at = now()`,
        [userId, day, JSON.stringify(actions), refreshCount],
      );
    });
  }
}
