/**
 * [BILLING-DUNNING · D8] Retention after a subscription ends. For each ENDED account the daily job:
 *   - emails a deletion warning 30 days and 7 days before (once each),
 *   - at 90 days after the end, deletes the account through the EXISTING account-deletion path.
 * A rep who pays during the 90 days is reactivated (billingState → active, endedAt cleared) by the
 * payment_succeeded webhook, so they drop out of listEnded() and are NEVER deleted (the test proves it).
 */
import type { BillingEmailHook } from './billing-service.js';
import type { SubscriptionRepository } from '../../ports/billing.js';
import { retentionAction } from './billing-dunning.js';

export interface BillingRetentionDeps {
  subs: Pick<SubscriptionRepository, 'listEnded' | 'update'>;
  /** The existing account-deletion path (AccountService.deleteAccount) — same reach as a rep delete. */
  deleteAccount: (userId: string) => Promise<void>;
  emailHook?: Pick<BillingEmailHook, 'deletionWarning'>;
  now?: () => number;
}

export class BillingRetentionService {
  constructor(private readonly deps: BillingRetentionDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  async run(): Promise<{ scanned: number; warned30d: number; warned7d: number; deleted: number }> {
    const ended = await this.deps.subs.listEnded();
    let warned30d = 0, warned7d = 0, deleted = 0;
    for (const s of ended) {
      const a = retentionAction(s, this.now());
      if (a.delete) {
        await this.deps.deleteAccount(s.userId); // existing deletion path (cascades the row away)
        deleted += 1;
        continue;
      }
      if (a.warn30d) {
        if (this.deps.emailHook?.deletionWarning) await this.safe(() => this.deps.emailHook!.deletionWarning!(s.userId, 30));
        await this.deps.subs.update(s.userId, { deletionWarned30d: true });
        warned30d += 1;
      }
      if (a.warn7d) {
        if (this.deps.emailHook?.deletionWarning) await this.safe(() => this.deps.emailHook!.deletionWarning!(s.userId, 7));
        await this.deps.subs.update(s.userId, { deletionWarned7d: true });
        warned7d += 1;
      }
    }
    return { scanned: ended.length, warned30d, warned7d, deleted };
  }

  private async safe(fn: () => Promise<void>): Promise<void> {
    try { await fn(); } catch (err) { console.warn(`[billing-retention] email failed: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
