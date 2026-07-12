import type { Pool } from 'pg';
import type {
  NotificationEntry,
  NotificationRecord,
  NotificationRepository,
  NotificationType,
} from '../../ports/notification-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  type: string;
  dedupe_key: string;
  client_id: string | null;
  title: string;
  body: string;
  read: boolean;
  created_at: Date;
}

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    dedupeKey: row.dedupe_key,
    clientId: row.client_id,
    title: row.title,
    body: row.body,
    read: row.read,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, type, dedupe_key, client_id, title, body, read, created_at';

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async createIfAbsent(userId: string, entry: NotificationEntry): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO notifications (user_id, type, dedupe_key, client_id, title, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [userId, entry.type, entry.dedupeKey, entry.clientId, entry.title, entry.body],
      );
      return rows.length > 0;
    });
  }

  async listByUser(userId: string): Promise<NotificationRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('UPDATE notifications SET read = true WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    });
  }
}
