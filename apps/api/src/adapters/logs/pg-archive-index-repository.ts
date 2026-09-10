import type { Pool } from 'pg';
import type {
  ArchiveIndexRepository,
  ArchiveObjectInput,
  ArchiveObjectRecord,
} from '../../ports/archive-index-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  user_id: string;
  collection: string;
  partition: string;
  object_key: string;
  row_count: number;
  archived_at: Date;
}

/**
 * [TRAINING-ARCHIVE] Tenant ops (upsert/list/delete) run on the app pool under RLS; the cross-tenant
 * totalRowCount for /health runs on the SUPERUSER pool (RLS would hide other tenants), like the other
 * ops aggregates. rootPool falls back to the app pool when not provided.
 */
export class PgArchiveIndexRepository implements ArchiveIndexRepository {
  constructor(private readonly pool: Pool, private readonly rootPool: Pool = pool) {}

  async upsert(userId: string, entry: ArchiveObjectInput): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO training_archive_objects (user_id, collection, partition, object_key, row_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, collection, partition)
         DO UPDATE SET object_key = EXCLUDED.object_key, row_count = EXCLUDED.row_count, archived_at = now()`,
        [userId, entry.collection, entry.partition, entry.objectKey, entry.rowCount],
      );
    });
  }

  async listByUser(userId: string): Promise<ArchiveObjectRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT user_id, collection, partition, object_key, row_count, archived_at
         FROM training_archive_objects WHERE user_id = $1 ORDER BY collection, partition`,
        [userId],
      );
      return (rows as unknown as Row[]).map((r) => ({
        userId: r.user_id,
        collection: r.collection,
        partition: r.partition,
        objectKey: r.object_key,
        rowCount: r.row_count,
        archivedAt: r.archived_at.getTime(),
      }));
    });
  }

  async deleteByUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(`DELETE FROM training_archive_objects WHERE user_id = $1`, [userId]);
    });
  }

  async totalRowCount(): Promise<number> {
    const { rows } = await this.rootPool.query<{ n: string }>(
      `SELECT COALESCE(sum(row_count), 0) AS n FROM training_archive_objects`,
    );
    return Number(rows[0]?.n ?? '0');
  }
}
