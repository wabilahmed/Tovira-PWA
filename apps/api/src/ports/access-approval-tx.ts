import type { AccessRequestRecord } from './access-request-repository.js';

/** The atomic approval step (BETA-5): create the (unusable) user, create its invite, and flip the
 *  request to 'invited' + link the user — all in ONE transaction, or nothing. The user INSERT is
 *  delegated to pg-user-repository.ts (the [USERS-GUARD] canonical file) on the shared tx client. */
export interface ApproveInput {
  accessRequestId: string;
  email: string;
  /** An unusable password hash (random preimage) — the account cannot be logged into until BETA-6. */
  passwordHash: string;
  /** Opaque per-user share code for the new account. */
  userReferralCode: string;
  invite: { tokenHash: string; expiresAt: number; createdBy: string };
  reviewedAt: number;
}

export interface AccessApprovalTx {
  /** Atomic. Succeeds only if the request is still 'pending'. Returns the new userId + updated request. */
  approve(input: ApproveInput): Promise<{ userId: string; record: AccessRequestRecord }>;
}

/** Thrown when the request is not in a state that can be approved (e.g. already invited/rejected). */
export class NotPendingError extends Error {
  constructor() {
    super('access request is not pending');
    this.name = 'NotPendingError';
  }
}
