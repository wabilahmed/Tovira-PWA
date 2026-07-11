import type { Pool } from 'pg';
import type { ClientRecord, ClientRepository } from '../../ports/client-repository.js';
import { withTenant } from '../../db/tenant.js';

interface ClientRow {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
}

function toRecord(row: ClientRow): ClientRecord {
  return { id: row.id, userId: row.user_id, name: row.name, createdAt: row.created_at.getTime() };
}

/**
 * Postgres-backed client store. Every method runs inside a tenant transaction
 * (RLS enforced by the non-superuser connection). App-layer `WHERE user_id`
 * filters are defense in depth; RLS is the hard safety net that holds even if
 * one were dropped.
 */
export class PgClientRepository implements ClientRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, name: string): Promise<ClientRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO clients (user_id, name) VALUES ($1, $2)
         RETURNING id, user_id, name, created_at`,
        [userId, name],
      );
      return toRecord(rows[0] as unknown as ClientRow);
    });
  }

  async listByUser(userId: string): Promise<ClientRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, user_id, name, created_at FROM clients
         WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return (rows as unknown as ClientRow[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<ClientRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      // No user_id filter here on purpose — RLS alone must scope this row.
      const { rows } = await c.query(
        'SELECT id, user_id, name, created_at FROM clients WHERE id = $1',
        [id],
      );
      return rows[0] ? toRecord(rows[0] as unknown as ClientRow) : null;
    });
  }
}
