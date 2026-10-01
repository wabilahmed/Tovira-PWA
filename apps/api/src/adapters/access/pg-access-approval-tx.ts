import type { Pool } from 'pg';
import type { AccessApprovalTx, ApproveInput } from '../../ports/access-approval-tx.js';
import { NotPendingError } from '../../ports/access-approval-tx.js';
import type { AccessRequestRecord } from '../../ports/access-request-repository.js';
import type { PgUserRepository } from '../auth/pg-user-repository.js';
import { rowToAccessRequest, type Row } from './pg-access-request-repository.js';

/** Postgres atomic approval. One client, one transaction: user INSERT (delegated to pg-user-repository
 *  on this client, per [USERS-GUARD]) → invite INSERT → access_request flip, all-or-nothing. */
export class PgAccessApprovalTx implements AccessApprovalTx {
  constructor(
    private readonly pool: Pool,
    private readonly users: PgUserRepository,
  ) {}

  async approve(input: ApproveInput): Promise<{ userId: string; record: AccessRequestRecord }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userId = await this.users.createInvitedWithClient(client, input.email, input.passwordHash, input.userReferralCode);
      await client.query(
        `INSERT INTO invites (token_hash, access_request_id, user_id, expires_at, created_by)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5)`,
        [input.invite.tokenHash, input.accessRequestId, userId, input.invite.expiresAt, input.invite.createdBy],
      );
      const { rows } = await client.query<Row>(
        `UPDATE access_requests
           SET status = 'invited', linked_user_id = $2, reviewed_at = to_timestamp($3 / 1000.0)
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [input.accessRequestId, userId, input.reviewedAt],
      );
      if (!rows[0]) throw new NotPendingError(); // triggers ROLLBACK below — nothing half-done
      await client.query('COMMIT');
      return { userId, record: rowToAccessRequest(rows[0]) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
