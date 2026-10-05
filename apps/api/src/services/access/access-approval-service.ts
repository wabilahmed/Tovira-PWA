import { createHash, randomBytes } from 'node:crypto';
import type { AccessApprovalTx } from '../../ports/access-approval-tx.js';
import { NotPendingError } from '../../ports/access-approval-tx.js';
import type { AccessRequestRecord, AccessRequestRepository, AccessRequestStatus } from '../../ports/access-request-repository.js';
import type { InviteRepository } from '../../ports/invite-repository.js';
import type { RateLimiter } from '../security/rate-limiter.js';
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

/** [BETA-8] The invite was real and eligible but the per-invite resend rate limit (3/24h) is spent. */
export class ResendRateLimitedError extends Error {
  constructor() {
    super('invite resend rate limit reached');
    this.name = 'ResendRateLimitedError';
  }
}

/** [BETA-8] Resends allowed per invite per 24h. Derivation: enough for a lost email and a typo'd inbox;
 *  low enough that the button can't be used to spam an address. */
export const INVITE_RESEND_MAX_PER_DAY = 3;

export interface AccessApprovalDeps {
  requests: AccessRequestRepository;
  tx: AccessApprovalTx;
  hasher: PasswordHasher;
  /** [BETA-8] Read/re-issue invites for the resend flow. Optional (older wiring); resend no-ops without it. */
  invites?: InviteRepository;
  /** [BETA-8] Per-invite (access-request id) resend throttle, 3/24h. Optional. */
  resendLimiter?: RateLimiter;
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

  /**
   * [BETA-8] Self-serve resend from an expired invite link. Takes ONLY the (expired) token — never an
   * address — and sends the new link to the ORIGINAL invited email, so whoever clicks the button cannot
   * redirect the invite. The response is identical whether or not the token resolves to an invite, so the
   * endpoint can't probe for invites. Throws ResendRateLimitedError once the per-invite 3/24h budget is spent.
   */
  async resendInvite(rawToken: string): Promise<{ ok: true }> {
    if (this.deps.invites) {
      const inv = await this.deps.invites.findByToken(hashToken(rawToken));
      if (inv) {
        const req = await this.deps.requests.get(inv.accessRequestId);
        // Only while approved+invited and NOT yet accepted (an 'activated' or rejected request → nothing).
        if (req && req.status === 'invited') {
          if (this.deps.resendLimiter) {
            if (this.deps.resendLimiter.check(inv.accessRequestId, this.now()).limited) throw new ResendRateLimitedError();
            this.deps.resendLimiter.record(inv.accessRequestId, this.now());
          }
          await this.freshInvite(inv.accessRequestId, inv.userId, req.workEmail, inv.createdBy);
        }
      }
    }
    return { ok: true }; // identical whether or not an invite existed (anti-enumeration)
  }

  /** [BETA-8] Operator re-issue by request id (token-gated ops route). Same invalidation rule; the link
   *  still goes to the original invited address. Only for an approved+invited, not-yet-accepted request. */
  async reissueByRequestId(id: string, opts: { createdBy: string }): Promise<AccessRequestRecord> {
    const req = await this.deps.requests.get(id);
    if (!req) throw new AccessRequestNotFoundError();
    if (req.status !== 'invited' || !req.linkedUserId) throw new NotPendingError();
    await this.freshInvite(id, req.linkedUserId, req.workEmail, opts.createdBy);
    return req;
  }

  /** Mint a fresh token, invalidate earlier links for the request, and email the new link to `email` —
   *  always the ORIGINAL invited address, never a caller-supplied one. */
  private async freshInvite(accessRequestId: string, userId: string, email: string, createdBy: string): Promise<void> {
    const rawToken = randomBytes(32).toString('base64url');
    await this.deps.invites!.reissue({ accessRequestId, userId, tokenHash: hashToken(rawToken), expiresAt: this.now() + INVITE_TTL_DAYS * DAY_MS, createdBy });
    try {
      await this.deps.sendInvite(email, `${this.deps.appBaseUrl}/invite?token=${encodeURIComponent(rawToken)}`);
    } catch (err) {
      console.warn('invite resend email failed; the new link is valid and can be resent', err);
    }
  }
}
