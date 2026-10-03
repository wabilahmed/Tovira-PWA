import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type {
  AiAllowanceRepository,
  AiMonth,
  GlobalSpendResult,
  ReserveResult,
} from '../../ports/ai-allowance-repository.js';

interface MonthRow {
  user_id: string;
  period_key: string;
  period_start_ms: string;
  allowance_aed: string;
  topup_aed: string;
  spent_aed: string;
  reserved_aed: string;
}

function toMonth(r: MonthRow): AiMonth {
  return {
    userId: r.user_id,
    periodKey: r.period_key,
    periodStartMs: Number(r.period_start_ms),
    allowanceAed: Number(r.allowance_aed),
    topupAed: Number(r.topup_aed),
    spentAed: Number(r.spent_aed),
    reservedAed: Number(r.reserved_aed),
  };
}

const MONTH_COLS = 'user_id, period_key, period_start_ms, allowance_aed, topup_aed, spent_aed, reserved_aed';

/**
 * [USAGE-ALLOWANCE] Postgres AI-allowance ledger. Per-account ops run as the app role under RLS
 * (withTenant). The reservation is a SINGLE conditional UPDATE — atomic at the DB, so parallel reserves
 * can never both fit the same headroom. Cross-tenant ops (the stale-reservation sweep and the global
 * record) run on the SUPERUSER pool so they see every tenant / the un-scoped global row.
 */
export class PgAiAllowanceRepository implements AiAllowanceRepository {
  constructor(private readonly appPool: Pool, private readonly adminPool: Pool) {}

  async ensureMonth(userId: string, periodKey: string, periodStartMs: number, allowanceAed: number): Promise<AiMonth> {
    return withTenant(this.appPool, userId, async (c) => {
      const existing = await c.query(`SELECT ${MONTH_COLS} FROM ai_usage_month WHERE user_id = $1 AND period_key = $2`, [userId, periodKey]);
      if (existing.rows[0]) return toMonth(existing.rows[0] as unknown as MonthRow);
      // Carry forward the previous window's REMAINING top-up (D7/D8).
      const prev = await c.query(
        `SELECT allowance_aed, topup_aed, spent_aed FROM ai_usage_month
         WHERE user_id = $1 AND period_start_ms < $2 ORDER BY period_start_ms DESC LIMIT 1`,
        [userId, periodStartMs],
      );
      let carried = 0;
      if (prev.rows[0]) {
        const p = prev.rows[0] as { allowance_aed: string; topup_aed: string; spent_aed: string };
        carried = Math.max(0, Number(p.topup_aed) - Math.max(0, Number(p.spent_aed) - Number(p.allowance_aed)));
      }
      await c.query(
        `INSERT INTO ai_usage_month (user_id, period_key, period_start_ms, allowance_aed, topup_aed)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, period_key) DO NOTHING`,
        [userId, periodKey, periodStartMs, allowanceAed, carried],
      );
      const row = await c.query(`SELECT ${MONTH_COLS} FROM ai_usage_month WHERE user_id = $1 AND period_key = $2`, [userId, periodKey]);
      return toMonth(row.rows[0] as unknown as MonthRow);
    });
  }

  async reserve(userId: string, periodKey: string, estimateAed: number, expiresAtMs: number): Promise<ReserveResult> {
    return withTenant(this.appPool, userId, async (c) => {
      const upd = await c.query(
        `UPDATE ai_usage_month SET reserved_aed = reserved_aed + $3, updated_at = now()
         WHERE user_id = $1 AND period_key = $2
           AND spent_aed + reserved_aed + $3 <= allowance_aed + topup_aed
         RETURNING user_id`,
        [userId, periodKey, estimateAed],
      );
      if (upd.rows.length === 0) return { ok: false };
      const ins = await c.query(
        `INSERT INTO ai_reservation (user_id, period_key, estimate_aed, status, expires_at)
         VALUES ($1, $2, $3, 'open', to_timestamp($4 / 1000.0)) RETURNING id`,
        [userId, periodKey, estimateAed, expiresAtMs],
      );
      return { ok: true, reservationId: String((ins.rows[0] as { id: string }).id) };
    });
  }

  async settle(userId: string, reservationId: string, actualAed: number): Promise<void> {
    await withTenant(this.appPool, userId, async (c) => {
      const r = await c.query(
        `UPDATE ai_reservation SET status = 'settled' WHERE id = $1 AND user_id = $2 AND status = 'open'
         RETURNING period_key, estimate_aed`,
        [reservationId, userId],
      );
      if (r.rows.length === 0) return;
      const { period_key, estimate_aed } = r.rows[0] as { period_key: string; estimate_aed: string };
      await c.query(
        `UPDATE ai_usage_month SET reserved_aed = GREATEST(0, reserved_aed - $3), spent_aed = spent_aed + $4, updated_at = now()
         WHERE user_id = $1 AND period_key = $2`,
        [userId, period_key, Number(estimate_aed), Math.max(0, actualAed)],
      );
    });
  }

  async release(userId: string, reservationId: string): Promise<void> {
    await withTenant(this.appPool, userId, async (c) => {
      const r = await c.query(
        `UPDATE ai_reservation SET status = 'released' WHERE id = $1 AND user_id = $2 AND status = 'open'
         RETURNING period_key, estimate_aed`,
        [reservationId, userId],
      );
      if (r.rows.length === 0) return;
      const { period_key, estimate_aed } = r.rows[0] as { period_key: string; estimate_aed: string };
      await c.query(
        `UPDATE ai_usage_month SET reserved_aed = GREATEST(0, reserved_aed - $3), updated_at = now()
         WHERE user_id = $1 AND period_key = $2`,
        [userId, period_key, Number(estimate_aed)],
      );
    });
  }

  /** Cross-tenant sweep on the SUPERUSER pool (RLS would hide other reps' stale reservations). */
  async expireStale(nowMs: number): Promise<number> {
    const client = await this.adminPool.connect();
    try {
      await client.query('BEGIN');
      const exp = await client.query(
        `UPDATE ai_reservation SET status = 'expired'
         WHERE status = 'open' AND expires_at <= to_timestamp($1 / 1000.0)
         RETURNING user_id, period_key, estimate_aed`,
        [nowMs],
      );
      const byMonth = new Map<string, { userId: string; periodKey: string; est: number }>();
      for (const row of exp.rows as Array<{ user_id: string; period_key: string; estimate_aed: string }>) {
        const k = `${row.user_id}\u0000${row.period_key}`;
        const agg = byMonth.get(k) ?? { userId: row.user_id, periodKey: row.period_key, est: 0 };
        agg.est += Number(row.estimate_aed);
        byMonth.set(k, agg);
      }
      for (const a of byMonth.values()) {
        await client.query(
          `UPDATE ai_usage_month SET reserved_aed = GREATEST(0, reserved_aed - $3), updated_at = now()
           WHERE user_id = $1 AND period_key = $2`,
          [a.userId, a.periodKey, a.est],
        );
      }
      await client.query('COMMIT');
      return exp.rows.length;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* doomed tx */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async topUp(userId: string, periodKey: string, addedAed: number): Promise<void> {
    await withTenant(this.appPool, userId, async (c) => {
      await c.query(
        `UPDATE ai_usage_month SET topup_aed = topup_aed + $3, updated_at = now() WHERE user_id = $1 AND period_key = $2`,
        [userId, periodKey, Math.max(0, addedAed)],
      );
    });
  }

  async getMonth(userId: string, periodKey: string): Promise<AiMonth | null> {
    return withTenant(this.appPool, userId, async (c) => {
      const r = await c.query(`SELECT ${MONTH_COLS} FROM ai_usage_month WHERE user_id = $1 AND period_key = $2`, [userId, periodKey]);
      return r.rows[0] ? toMonth(r.rows[0] as unknown as MonthRow) : null;
    });
  }

  /** Global record on the SUPERUSER pool (the row is not tenant-scoped). One-shot alert flag. */
  async recordGlobal(ym: string, aed: number, alertThresholdAed: number): Promise<GlobalSpendResult> {
    const client = await this.adminPool.connect();
    try {
      await client.query('BEGIN');
      const up = await client.query(
        `INSERT INTO ai_global_month (ym, spent_aed) VALUES ($1, $2)
         ON CONFLICT (ym) DO UPDATE SET spent_aed = ai_global_month.spent_aed + EXCLUDED.spent_aed, updated_at = now()
         RETURNING spent_aed, alert_sent`,
        [ym, Math.max(0, aed)],
      );
      const { spent_aed, alert_sent } = up.rows[0] as { spent_aed: string; alert_sent: boolean };
      const total = Number(spent_aed);
      const before = total - Math.max(0, aed);
      const crossed = !alert_sent && before < alertThresholdAed && total >= alertThresholdAed;
      if (crossed) await client.query(`UPDATE ai_global_month SET alert_sent = true WHERE ym = $1`, [ym]);
      await client.query('COMMIT');
      return { totalAed: total, crossedAlert: crossed };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* doomed tx */ }
      throw err;
    } finally {
      client.release();
    }
  }
}
