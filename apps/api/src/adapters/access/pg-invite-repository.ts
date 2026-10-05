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

  async peek(tokenHash: string, nowMs: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM invites WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > to_timestamp($2 / 1000.0) LIMIT 1`,
      [tokenHash, nowMs],
    );
    return rows.length > 0;
  }

  /** [BETA-8] Non-consuming lookup that IGNORES expiry/consumption, so an expired link can still resolve
   *  to its request + the original invited address. */
  async findByToken(tokenHash: string): Promise<{ tokenHash: string; accessRequestId: string; userId: string; expiresAt: number; createdBy: string } | null> {
    const { rows } = await this.pool.query<{ token_hash: string; access_request_id: string; user_id: string; expires_at: Date; created_by: string }>(
      `SELECT token_hash, access_request_id, user_id, expires_at, created_by FROM invites WHERE token_hash = $1`,
      [tokenHash],
    );
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, accessRequestId: r.access_request_id, userId: r.user_id, expiresAt: r.expires_at.getTime(), createdBy: r.created_by } : null;
  }

  /** [BETA-8] Re-issue: in one transaction DELETE every earlier link for the request (so all old tokens
   *  fail `consume`), then INSERT the new one — atomic, keyed by access_request_id. */
  async reissue(input: { accessRequestId: string; userId: string; tokenHash: string; expiresAt: number; createdBy: string }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM invites WHERE access_request_id = $1`, [input.accessRequestId]);
      await client.query(
        `INSERT INTO invites (token_hash, access_request_id, user_id, expires_at, created_by)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5)`,
        [input.tokenHash, input.accessRequestId, input.userId, input.expiresAt, input.createdBy],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
