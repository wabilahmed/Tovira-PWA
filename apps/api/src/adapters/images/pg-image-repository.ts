import type { Pool } from 'pg';
import type { ImageRecord, ImageRepository, NewImage } from '../../ports/image-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  client_id: string;
  storage_key: string;
  content_type: string;
  created_at: Date;
}

function toRecord(r: Row): ImageRecord {
  return {
    id: r.id,
    userId: r.user_id,
    clientId: r.client_id,
    storageKey: r.storage_key,
    contentType: r.content_type,
    createdAt: r.created_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, client_id, storage_key, content_type, created_at';

export class PgImageRepository implements ImageRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, image: NewImage): Promise<ImageRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO images (user_id, client_id, storage_key, content_type)
         VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [userId, image.clientId, image.storageKey, image.contentType],
      );
      return toRecord(rows[0] as unknown as Row);
    });
  }

  async listByClient(userId: string, clientId: string): Promise<ImageRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM images WHERE client_id = $1 ORDER BY created_at DESC`,
        [clientId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<ImageRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM images WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }
}
