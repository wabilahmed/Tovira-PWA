import { createHash, randomBytes } from 'node:crypto';
import type { AccessApprovalTx } from '../../ports/access-approval-tx.js';
import { NotPendingError } from '../../ports/access-approval-tx.js';
import type { AccessRequestRecord, AccessRequestRepository, AccessRequestStatus } from '../../ports/access-request-repository.js';
import type { PasswordHasher } from '../auth/password.js';

/** Invite lifetime. Derivation: a review-and-invite flow where the operator approves within ~2 business
 *  days; 7 days gives the invitee a comfortable window to act on the link without leaving a usable
 *  credential outstanding indefinitely. A lapsed invite fails closed (account stays unusable); re-approval
 *  (future) would mint a fresh one. */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AccessRequestNotFoundError extends Error {
  constructor() {
    super('access request not found');
    this.name = 'AccessRequestNotFoundError';
  }
}

export interface AccessApprovalDeps {
  requests: AccessRequestRepository;
  tx: AccessApprovalTx;
  hasher: PasswordHasher;
  /** Deliver the invite link (set password + accept terms). Best-effort; a failure never rolls back
   *  the already-committed approval. */
  sendInvite: (to: string, inviteUrl: string) => Promise<void>;
  /** Apply a persisted referral code at approval, via the existing ReferralService. Best-effort: a
   *  referral failure must never fail the approval (same rule as signup). Returns whether it credited. */
  applyReferral?: (code: string, userId: string, email: string) => Promise<boolean>;
  appBaseUrl: string;
  now?: () => number;
}

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** [BETA-5] Approve/reject access requests + provision the invite. */
export class AccessApprovalService {
  private readonly now: () => number;
  constructor(private readonly deps: AccessApprovalDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  list(status?: AccessRequestStatus): Promise<AccessRequestRecord[]> {
    return this.deps.requests.list(status);
  }

  get(id: string): Promise<AccessRequestRecord | null> {
    return this.deps.requests.get(id);
  }

  /** Approve: atomically create the (unusable) account + single-use invite + flip to 'invited', then
   *  best-effort apply the persisted referral and send the invite email. Throws NotPendingError (from the
   *  tx) if the request is not pending, or AccessRequestNotFoundError if it does not exist. */
  async approve(id: string, opts: { createdBy: string }): Promise<AccessRequestRecord> {
    const req = await this.deps.requests.get(id);
    if (!req) throw new AccessRequestNotFoundError();

    const rawToken = randomBytes(32).toString('base64url');
    // Unusable password: a random preimage nobody holds. Full-strength hash so login runs the real KDF
    // (no timing oracle) and always fails until BETA-6 overwrites it.
    const passwordHash = await this.deps.hasher.hash(randomBytes(32).toString('base64url'));
    const now = this.now();

    const { userId, record } = await this.deps.tx.approve({
      accessRequestId: id,
      email: req.workEmail,
      passwordHash,
      userReferralCode: randomBytes(6).toString('base64url'),
      invite: { tokenHash: hashToken(rawToken), expiresAt: now + INVITE_TTL_DAYS * DAY_MS, createdBy: opts.createdBy },
      reviewedAt: now,
    });

    // Both best-effort and post-commit: a mail or referral failure must not undo an approval that
    // already created the account + invite (the operator can resend/re-credit).
    if (req.referralCode && this.deps.applyReferral) {
      try {
        await this.deps.applyReferral(req.referralCode, userId, req.workEmail);
      } catch (err) {
        console.warn('referral application failed at approval; approval stands', err);
      }
    }
    try {
      await this.deps.sendInvite(req.workEmail, `${this.deps.appBaseUrl}/invite?token=${encodeURIComponent(rawToken)}`);
    } catch (err) {
      console.warn('invite email failed; approval stands (resend to deliver the link)', err);
    }
    return record;
  }

  /** Reject: record status + the reviewer note. Sends NO email (rejections are handled personally). */
  async reject(id: string, note: string, opts: { reviewedBy?: string } = {}): Promise<AccessRequestRecord> {
    void opts;
    const req = await this.deps.requests.get(id);
    if (!req) throw new AccessRequestNotFoundError();
    if (req.status !== 'pending') throw new NotPendingError(); // only a pending request can be rejected
    const record = await this.deps.requests.review(id, { status: 'rejected', reviewedAt: this.now(), reviewedNote: note });
    return record!;
  }
}
