import type { Pool } from 'pg';
import type { SensitiveFlagStatsRepository, SensitiveFlagRestoreStat } from '../../ports/sensitive-flag-stats-repository.js';

/**
 * [RESTORE-SIGNAL] Durable aggregate counter. The table has no tenant column BY DESIGN — the signal is
 * not attributable to a rep or their book whichever pool writes it. Stores only (category, span, count);
 * never an identifier and never message content. Granted to tovira_app, so it uses the app pool.
 */
export class PgSensitiveFlagStatsRepository implements SensitiveFlagStatsRepository {
  constructor(private readonly pool: Pool) {}

  async recordRestore(category: string, span: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sensitive_flag_restores (category, span, restored, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (category, span)
       DO UPDATE SET restored = sensitive_flag_restores.restored + 1, updated_at = now()`,
      [category, span],
    );
  }

  async list(): Promise<SensitiveFlagRestoreStat[]> {
    const { rows } = await this.pool.query(
      `SELECT category, span, restored FROM sensitive_flag_restores ORDER BY restored DESC, category, span`,
    );
    return rows.map((r) => ({ category: String(r.category), span: String(r.span), restored: Number(r.restored) }));
  }
}
