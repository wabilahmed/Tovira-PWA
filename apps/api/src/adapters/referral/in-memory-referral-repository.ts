import type { ReferralRepository } from '../../ports/referral-repository.js';

/** In-memory referral ledger for tests. A referred email is credited once. */
export class InMemoryReferralRepository implements ReferralRepository {
  private readonly referredEmails = new Set<string>();

  async record(_referrerId: string, referredEmail: string): Promise<boolean> {
    const key = referredEmail.trim().toLowerCase();
    if (this.referredEmails.has(key)) return false; // already referred → no credit
    this.referredEmails.add(key);
    return true;
  }
}
