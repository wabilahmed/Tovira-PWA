import type { Pool } from 'pg';
import type { ActivateInput, InviteActivationTx } from '../../ports/invite-activation-tx.js';
import type { PgUserRepository } from '../auth/pg-user-repository.js';

/** Postgres atomic invite acceptance. One client, one transaction: the consume UPDATE is the gate
 *  (row-locked, so only one of N concurrent requests wins it); on a win, set password + terms + flip
 *  the request to 'activated', all committed together. users SQL is delegated to pg-user-repository. */
export class PgInviteActivationTx implements InviteActivationTx {
  constructor(
    private readonly pool: Pool,
    private readonly users: PgUserRepository,
  ) {}

  async activate(input: ActivateInput): Promise<{ userId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query<{ user_id: string; access_request_id: string }>(
        `UPDATE invites SET consumed_at = to_timestamp($2 / 1000.0)
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > to_timestamp($2 / 1000.0)
         RETURNING user_id, access_request_id`,
        [input.tokenHash, input.now],
      );
      if (!consumed.rows[0]) {
        await client.query('ROLLBACK');
        return null; // unknown / expired / already consumed — nothing changed
      }
      const { user_id: userId, access_request_id: accessRequestId } = consumed.rows[0];
      await this.users.setPasswordAndTermsWithClient(client, userId, input.passwordHash, input.termsVersion, input.now, input.termsAcceptedIp);
      await client.query(`UPDATE access_requests SET status = 'activated' WHERE id = $1`, [accessRequestId]);
      await client.query('COMMIT');
      return { userId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
