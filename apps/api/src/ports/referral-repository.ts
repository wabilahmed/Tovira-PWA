/**
 * Port: referral tracking (P5-6). Anti-farming is the point — a given referred
 * email can only ever be credited once, so repeat-referring the same person earns
 * nothing. Self-referral is rejected in the service. Tenant-agnostic (a global
 * anti-abuse ledger), like trial grants.
 */
export interface ReferralRepository {
  /** Record referrer→referredEmail. Returns true only if newly recorded. */
  record(referrerId: string, referredEmail: string): Promise<boolean>;
}
