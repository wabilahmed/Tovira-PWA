import type { Pool } from 'pg';
import type { ImportAckRepository } from '../../ports/import-ack-repository.js';
import { withTenant } from '../../db/tenant.js';

/**
 * Postgres first-import acknowledgement store. One row per account (user_id PK). First write wins via
 * ON CONFLICT DO NOTHING, so re-acknowledging keeps the original timestamp. RLS scopes every access.
 */
export class PgImportAckRepository implements ImportAckRepository {
  constructor(private readonly pool: Pool) {}

  async acknowledgedAt(userId: string): Promise<number | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT acknowledged_at FROM import_acknowledgements WHERE user_id = $1', [userId]);
      const at = rows[0]?.acknowledged_at as Date | undefined;
      return at ? at.getTime() : null;
    });
  }

  async acknowledge(userId: string, atMs: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO import_acknowledgements (user_id, acknowledged_at) VALUES ($1, to_timestamp($2 / 1000.0))
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, atMs],
      );
    });
  }

  async purgeUser(userId: string): Promise<void> {
    // Also removed by the users FK cascade; explicit for symmetry with the other stores.
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM import_acknowledgements WHERE user_id = $1', [userId]);
    });
  }
}
