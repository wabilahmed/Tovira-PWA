import type { Pool } from 'pg';
import type { PushBudgetRepository } from '../../ports/push.js';

/**
 * The silence-budget ledger (max 2 pushes/rep/day). A SYSTEM table (the daily
 * scan runs without a user session), filtered explicitly by user_id.
 */
export class PgPushBudgetRepository implements PushBudgetRepository {
  constructor(private readonly pool: Pool) {}

  async countSent(userId: string, dayIso: string): Promise<number> {
    const { rows } = await this.pool.query<{ sent: number }>(
      'SELECT sent FROM push_budget WHERE user_id = $1 AND day = $2',
      [userId, dayIso],
    );
    return rows[0] ? Number(rows[0].sent) : 0;
  }

  async recordSent(userId: string, dayIso: string, count: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_budget (user_id, day, sent) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, day) DO UPDATE SET sent = push_budget.sent + EXCLUDED.sent`,
      [userId, dayIso, count],
    );
  }
}
