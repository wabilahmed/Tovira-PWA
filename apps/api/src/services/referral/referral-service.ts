import type { ReferralRepository } from '../../ports/referral-repository.js';

export interface ReferralGrantor {
  /** Grants a free month; returns false if the account doesn't exist. */
  grantReferralMonth(userId: string): Promise<boolean>;
}

/**
 * Give-a-month / get-a-month referral (P5-6). When a referred person signs up,
 * BOTH accounts get one free month — exactly once. No self-referral, no repeat
 * referral of the same person (enforced by the repo's once-per-email rule).
 */
export class ReferralService {
  constructor(
    private readonly repo: ReferralRepository,
    private readonly grantor: ReferralGrantor,
  ) {}

  /** Returns true only if the referral was valid and both were credited. */
  async apply(referrerId: string, referredUserId: string, referredEmail: string): Promise<boolean> {
    if (!referrerId || referrerId === referredUserId) return false; // self-referral → no credit
    const isNew = await this.repo.record(referrerId, referredEmail);
    if (!isNew) return false; // this person was already referred → no credit
    // A valid referrer is a real account. A garbage code credits no one.
    if (!(await this.grantor.grantReferralMonth(referrerId))) return false;
    await this.grantor.grantReferralMonth(referredUserId);
    return true;
  }
}
