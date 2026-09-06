import type { Pool } from 'pg';
import type { SpendOverrideRepository, SpendOverride, NewSpendOverride } from '../../ports/spend-override-repository.js';

interface Row {
  id: string; user_id: string; period_key: string; cap_aed: number; raised_by: string; reason: string; occurred_at: string;
}
const toOverride = (r: Row): SpendOverride => ({
  id: r.id, userId: r.user_id, periodKey: r.period_key, capAed: Number(r.cap_aed),
  raisedBy: r.raised_by, reason: r.reason, occurredAt: Number(r.occurred_at),
});
const COLS = `id, user_id, period_key, cap_aed, raised_by, reason, (extract(epoch from occurred_at) * 1000)::bigint AS occurred_at`;

/** Cross-tenant override + audit on the SUPERUSER pool (an ops action, not a rep's tenant data). */
export class PgSpendOverrideRepository implements SpendOverrideRepository {
  constructor(private readonly pool: Pool) {}

  async set(o: NewSpendOverride): Promise<SpendOverride> {
    const { rows } = await this.pool.query(
      `INSERT INTO spend_overrides (user_id, period_key, cap_aed, raised_by, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
      [o.userId, o.periodKey, o.capAed, o.raisedBy, o.reason],
    );
    return toOverride(rows[0] as unknown as Row);
  }

  async effectiveCap(userId: string, periodKey: string): Promise<number | null> {
    const { rows } = await this.pool.query(
      `SELECT cap_aed FROM spend_overrides WHERE user_id = $1 AND period_key = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [userId, periodKey],
    );
    return rows.length ? Number((rows[0] as { cap_aed: number }).cap_aed) : null;
  }

  async listAudit(limit: number): Promise<SpendOverride[]> {
    const { rows } = await this.pool.query(`SELECT ${COLS} FROM spend_overrides ORDER BY occurred_at DESC LIMIT $1`, [limit]);
    return (rows as unknown as Row[]).map(toOverride);
  }
}
