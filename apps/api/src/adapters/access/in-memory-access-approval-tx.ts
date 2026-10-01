import type { AccessApprovalTx, ApproveInput } from '../../ports/access-approval-tx.js';
import { NotPendingError } from '../../ports/access-approval-tx.js';
import type { AccessRequestRecord, AccessRequestRepository } from '../../ports/access-request-repository.js';
import type { InviteRecord } from '../../ports/invite-repository.js';
import type { UserRepository } from '../../ports/user-repository.js';

/** The invite-write surface the tx needs (insert + rollback-remove). */
interface InviteWriter {
  insert(rec: InviteRecord): void;
  remove(tokenHash: string): void;
}

/** In-memory atomic approval. JS is single-threaded between awaits; on any failure after the user is
 *  created, the user + invite are removed so the model matches the pg transaction's all-or-nothing. */
export class InMemoryAccessApprovalTx implements AccessApprovalTx {
  constructor(
    private readonly users: UserRepository,
    private readonly invites: InviteWriter,
    private readonly accessRequests: AccessRequestRepository,
  ) {}

  async approve(input: ApproveInput): Promise<{ userId: string; record: AccessRequestRecord }> {
    const req = await this.accessRequests.get(input.accessRequestId);
    if (!req || req.status !== 'pending') throw new NotPendingError();
    const user = await this.users.create({ email: input.email, passwordHash: input.passwordHash, referralCode: input.userReferralCode });
    try {
      this.invites.insert({ tokenHash: input.invite.tokenHash, accessRequestId: input.accessRequestId, userId: user.id, expiresAt: input.invite.expiresAt, createdBy: input.invite.createdBy });
      const record = await this.accessRequests.review(input.accessRequestId, { status: 'invited', reviewedAt: input.reviewedAt, linkedUserId: user.id });
      if (!record) throw new NotPendingError();
      return { userId: user.id, record };
    } catch (err) {
      // rollback everything created in this call
      this.invites.remove(input.invite.tokenHash);
      await this.users.delete(user.id);
      throw err;
    }
  }
}
