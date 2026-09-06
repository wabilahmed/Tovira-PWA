import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { SpendLedgerRepository, SpendClass, PeriodSpend } from '../../ports/spend-ledger-repository.js';

/**
 * [SPEND-CAP] Durable spend ledger. Per-rep writes/reads go through the app pool under RLS
 * (`withTenant`); the cross-tenant period distribution (for /health + ops) runs on the SUPERUSER
 * pool, RLS-bypassing — the cache-stats precedent. Given both pools; the root pool is optional and
 * only powers `listPeriod`.
 */
export class PgSpendLedgerRepository implements SpendLedgerRepository {
  constructor(private readonly appPool: Pool, private readonly rootPool?: Pool) {}

  async add(userId: string, periodKey: string, costClass: SpendClass, aed: number): Promise<void> {
    await withTenant(this.appPool, userId, async (c) => {
      await c.query(
        `INSERT INTO spend_ledger (user_id, period_key, cost_class, aed, calls, updated_at)
         VALUES ($1, $2, $3, $4, 1, now())
         ON CONFLICT (user_id, period_key, cost_class)
         DO UPDATE SET aed = spend_ledger.aed + EXCLUDED.aed, calls = spend_ledger.calls + 1, updated_at = now()`,
        [userId, periodKey, costClass, aed],
      );
    });
  }

  async getForPeriod(userId: string, periodKey: string): Promise<PeriodSpend> {
    return withTenant(this.appPool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT cost_class, aed, calls FROM spend_ledger WHERE user_id = $1 AND period_key = $2`,
        [userId, periodKey],
      );
      let totalAed = 0;
      const byClass = (rows as Array<{ cost_class: string; aed: number; calls: number }>).map((r) => {
        totalAed += Number(r.aed);
        return { costClass: r.cost_class as SpendClass, aed: Number(r.aed), calls: Number(r.calls) };
      });
      return { totalAed, byClass };
    });
  }

  async listPeriod(periodKey: string): Promise<Array<{ userId: string; totalAed: number }>> {
    const pool = this.rootPool ?? this.appPool; // cross-tenant; needs the superuser pool in prod
    const { rows } = await pool.query<{ user_id: string; total: number }>(
      `SELECT user_id, SUM(aed) AS total FROM spend_ledger WHERE period_key = $1 GROUP BY user_id ORDER BY total DESC`,
      [periodKey],
    );
    return rows.map((r) => ({ userId: r.user_id, totalAed: Number(r.total) }));
  }
}
