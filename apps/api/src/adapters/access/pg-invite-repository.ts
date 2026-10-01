import type { Pool } from 'pg';
import type { InviteRepository } from '../../ports/invite-repository.js';

/** Postgres-backed invite store. Only the hash is stored; burn is one atomic UPDATE (same shape as
 *  password_resets), so a link consumes exactly once even under concurrent requests. */
export class PgInviteRepository implements InviteRepository {
  constructor(private readonly pool: Pool) {}

  async consume(tokenHash: string, nowMs: number): Promise<{ userId: string; accessRequestId: string } | null> {
    const { rows } = await this.pool.query<{ user_id: string; access_request_id: string }>(
      `UPDATE invites SET consumed_at = to_timestamp($2 / 1000.0)
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > to_timestamp($2 / 1000.0)
       RETURNING user_id, access_request_id`,
      [tokenHash, nowMs],
    );
    return rows[0] ? { userId: rows[0].user_id, accessRequestId: rows[0].access_request_id } : null;
  }

  async hasOutstanding(userId: string, nowMs: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM invites WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > to_timestamp($2 / 1000.0) LIMIT 1`,
      [userId, nowMs],
    );
    return rows.length > 0;
  }
}
