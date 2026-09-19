import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { ErasureRequestRepository, ErasureRequestRecord, NewErasureRequest, ErasureRequestStatus } from '../../ports/erasure-request-repository.js';

interface Row { id: string; user_id: string; requester_names: string[]; requested_at: Date; window_ends_at: Date; status: ErasureRequestStatus }

/** RLS-backed pending erasure requests + retention window. Cascades on account delete. */
export class PgErasureRequestRepository implements ErasureRequestRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, input: NewErasureRequest): Promise<ErasureRequestRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO erasure_requests (user_id, requester_names, requested_at, window_ends_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))
         RETURNING id, user_id, requester_names, requested_at, window_ends_at, status`,
        [userId, input.requesterNames, input.requestedAt, input.windowEndsAt],
      );
      return toRecord(rows[0] as unknown as Row);
    });
  }

  async get(userId: string, id: string): Promise<ErasureRequestRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT id, user_id, requester_names, requested_at, window_ends_at, status FROM erasure_requests WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async setStatus(userId: string, id: string, status: ErasureRequestStatus): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`UPDATE erasure_requests SET status = $2 WHERE id = $1 RETURNING id`, [id, status]);
      return rows.length > 0;
    });
  }

  async listByUser(userId: string): Promise<ErasureRequestRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT id, user_id, requester_names, requested_at, window_ends_at, status FROM erasure_requests WHERE user_id = $1 ORDER BY requested_at DESC`, [userId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }
}

function toRecord(r: Row): ErasureRequestRecord {
  return { id: r.id, userId: r.user_id, requesterNames: r.requester_names, requestedAt: r.requested_at.getTime(), windowEndsAt: r.window_ends_at.getTime(), status: r.status };
}
