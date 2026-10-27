import type { Pool } from 'pg';
import type { GoingQuietAlert, GoingQuietAlertRepository } from '../../ports/going-quiet-alert-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row { id: string; client_id: string; quiet_since: Date; silent_days: number; reached_at: Date; reached_via: 'today' | 'push' }

/** [P47-2] Postgres going-quiet alerts (RLS-scoped). The first reach of a silence wins (ON CONFLICT DO NOTHING). */
export class PgGoingQuietAlertRepository implements GoingQuietAlertRepository {
  constructor(private readonly pool: Pool) {}
  async recordReached(userId: string, a: Omit<GoingQuietAlert, 'id'>): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO going_quiet_alerts (user_id, client_id, quiet_since, silent_days, reached_at, reached_via)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, to_timestamp($5 / 1000.0), $6)
         ON CONFLICT (user_id, client_id, quiet_since) DO NOTHING`,
        [userId, a.clientId, a.quietSince, a.silentDays, a.reachedAt, a.reachedVia],
      );
    });
  }
  async listByUser(userId: string): Promise<GoingQuietAlert[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT id, client_id, quiet_since, silent_days, reached_at, reached_via FROM going_quiet_alerts WHERE user_id = $1 ORDER BY reached_at', [userId]);
      return (rows as unknown as Row[]).map((r) => ({ id: r.id, clientId: r.client_id, quietSince: r.quiet_since.getTime(), silentDays: Number(r.silent_days), reachedAt: r.reached_at.getTime(), reachedVia: r.reached_via }));
    });
  }
}
