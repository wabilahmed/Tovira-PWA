/**
 * [BILLING-DUNNING · D4–D7] The daily failed-payment job. For every account with a running clock it:
 *   - retries the open invoice once a day via the Stripe API (app-driven, finding 4 / ruling 1),
 *   - sends the daily reminder (D4),
 *   - suspends at day 7 (D5),
 *   - stops retrying and ends at day 30 (D7).
 * A success is NOT handled here — that arrives as an invoice.payment_succeeded webhook which reactivates
 * (guard 3). This job never touches an `active` or `ended` account (guard 5). Idempotent: `dunningAction`
 * gates retry/remind to once per UTC day, so a double run in a day is a no-op.
 */
import type { BillingEmailHook } from './billing-service.js';
import type { StripeGateway, SubscriptionRepository } from '../../ports/billing.js';
import { dunningAction } from './billing-dunning.js';

export interface BillingDunningDeps {
  subs: Pick<SubscriptionRepository, 'listInDunning' | 'update'>;
  stripe: Pick<StripeGateway, 'payInvoice'>;
  emailHook?: BillingEmailHook;
  now?: () => number;
}

export class BillingDunningService {
  constructor(private readonly deps: BillingDunningDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** One daily pass. Returns a small summary for the job log / health. */
  async run(): Promise<{ scanned: number; retried: number; authRequired: number; suspended: number; ended: number }> {
    const subs = await this.deps.subs.listInDunning();
    let retried = 0, authRequired = 0, suspended = 0, ended = 0;
    for (const s of subs) {
      const nowMs = this.now();
      const action = dunningAction(s, nowMs);

      // Day 30: end (no retry). The account stays suspended-level access (D7); endedAt starts the D8 clock.
      if (action.nextState === 'ended') {
        await this.deps.subs.update(s.userId, { billingState: 'ended', endedAt: nowMs });
        if (this.deps.emailHook?.subscriptionEnded) await this.safe(() => this.deps.emailHook!.subscriptionEnded!(s.userId));
        ended += 1;
        continue;
      }

      // Day 7: suspend — but keep retrying + reminding through day 30.
      if (action.nextState === 'suspended') {
        await this.deps.subs.update(s.userId, { billingState: 'suspended' });
        if (this.deps.emailHook?.suspended) await this.safe(() => this.deps.emailHook!.suspended!(s.userId));
        suspended += 1;
      }

      if (action.retry && s.openInvoiceId) {
        const outcome = await this.deps.stripe.payInvoice(s.openInvoiceId);
        retried += 1;
        if (outcome === 'authentication_required') {
          authRequired += 1;
          await this.deps.subs.update(s.userId, { lastRetryAt: nowMs, authRequiredCount: s.authRequiredCount + 1 });
        } else if (outcome === 'failed') {
          await this.deps.subs.update(s.userId, { lastRetryAt: nowMs, hardDeclineCount: s.hardDeclineCount + 1 });
        } else {
          // 'paid' — rare here (the webhook normally reactivates); stamp the retry and let the webhook flip state.
          await this.deps.subs.update(s.userId, { lastRetryAt: nowMs });
        }
      } else if (action.retry) {
        await this.deps.subs.update(s.userId, { lastRetryAt: nowMs }); // no invoice id to pay; still mark the daily tick
      }

      if (action.remind && this.deps.emailHook?.dailyReminder) await this.safe(() => this.deps.emailHook!.dailyReminder!(s.userId));
    }
    return { scanned: subs.length, retried, authRequired, suspended, ended };
  }

  private async safe(fn: () => Promise<void>): Promise<void> {
    try { await fn(); } catch (err) { console.warn(`[billing-dunning] email failed: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
