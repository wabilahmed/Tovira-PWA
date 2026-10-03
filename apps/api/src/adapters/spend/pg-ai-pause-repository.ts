import type { Pool } from 'pg';
import type { AiPauseRepository } from '../../ports/ai-pause-repository.js';

/**
 * [USAGE-ALLOWANCE · D14] Postgres runtime kill switch — the single `ai_pause` row. Platform-global, so
 * it runs on the SUPERUSER pool (no tenant context), like the other ops-plane writes.
 */
export class PgAiPauseRepository implements AiPauseRepository {
  constructor(private readonly pool: Pool) {}

  async getPaused(): Promise<boolean> {
    const { rows } = await this.pool.query<{ paused: boolean }>('SELECT paused FROM ai_pause WHERE id = true');
    return rows[0]?.paused ?? false;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_pause (id, paused) VALUES (true, $1)
       ON CONFLICT (id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = now()`,
      [paused],
    );
  }
}
