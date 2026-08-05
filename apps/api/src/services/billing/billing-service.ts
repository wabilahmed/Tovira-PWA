import type {
  Plan,
  StripeGateway,
  SubscriptionRepository,
  TrialGrantRepository,
  WebhookEventRepository,
} from '../../ports/billing.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The activity bar for the +7-day trial extension (P5-1): notes on 3 DISTINCT clients. */
export const TRIAL_EXTENSION_MIN_CLIENTS = 3;
export const TRIAL_EXTENSION_DAYS = 7;

export interface Entitlement {
  entitled: boolean;
  status: string;
  trialEndsAt: number;
}

/**
 * Server-computed state of the trial-extension incentive (P5-1-UI). The client
 * renders this verbatim and NEVER computes eligibility itself.
 *  - `progress`: trialing, not yet extended → show how close they are.
 *  - `earned`:   extended and still trialing → confirm the new trial end.
 *  - `hidden`:   converted to paid, expired, or no trial → render nothing.
 */
export interface ExtensionIncentive {
  state: 'progress' | 'earned' | 'hidden';
  distinctClients: number;
  needed: number;
  remaining: number;
  extensionDays: number;
  trialEndsAt: number;
}

/**
 * Free trial + subscription state (P5-1/P5-2). Webhooks are the ONLY thing that
 * flips a subscription to active — a client-side success redirect never grants
 * access. Trials are tied to a durable email grant so deleting/recreating an
 * account can't farm a fresh trial.
 */
export class BillingService {
  constructor(
    private readonly subs: SubscriptionRepository,
    private readonly trials: TrialGrantRepository,
    private readonly events: WebhookEventRepository,
    private readonly stripe: StripeGateway,
    private readonly trialDays: number,
  ) {}

  async onSignup(userId: string, email: string, nowMs: number): Promise<void> {
    // Reuse the original grant for this email → no fresh trial on re-signup.
    const grantedAt = await this.trials.grantOrGet(email.trim().toLowerCase(), nowMs);
    await this.subs.create(userId, grantedAt + this.trialDays * DAY_MS);
  }

  /**
   * Activity-gated trial extension (P5-1): capturing notes on 3+ DISTINCT clients
   * unlocks +7 days, ONCE, server-side. Re-qualifying does nothing; a paid/expired
   * account never extends. Returns true only when it actually extended.
   */
  async extendTrialForActivity(userId: string, distinctClientsWithNotes: number, extensionDays = TRIAL_EXTENSION_DAYS): Promise<boolean> {
    const s = await this.subs.get(userId);
    if (!s || s.status !== 'trialing' || s.trialExtended) return false;
    if (distinctClientsWithNotes < TRIAL_EXTENSION_MIN_CLIENTS) return false;
    await this.subs.update(userId, { trialEndsAt: s.trialEndsAt + extensionDays * DAY_MS, trialExtended: true });
    return true;
  }

  /**
   * The server-owned incentive state (P5-1-UI). Read-only: it never extends —
   * that stays on the capture path in {@link extendTrialForActivity}. The count
   * of distinct clients-with-notes is passed in (computed the same way as the
   * extension trigger) so the progress the rep sees can never disagree with what
   * actually earns the extension.
   */
  async extensionIncentive(userId: string, distinctClientsWithNotes: number, nowMs: number): Promise<ExtensionIncentive> {
    const needed = TRIAL_EXTENSION_MIN_CLIENTS;
    const base = { distinctClients: distinctClientsWithNotes, needed, extensionDays: TRIAL_EXTENSION_DAYS };
    const s = await this.subs.get(userId);
    const trialingNow = !!s && s.status === 'trialing' && nowMs < s.trialEndsAt;
    // Converted to paid, expired, or no trial → nothing to nudge.
    if (!s || !trialingNow) {
      return { state: 'hidden', ...base, remaining: Math.max(0, needed - distinctClientsWithNotes), trialEndsAt: s?.trialEndsAt ?? 0 };
    }
    if (s.trialExtended) {
      return { state: 'earned', ...base, remaining: 0, trialEndsAt: s.trialEndsAt };
    }
    return { state: 'progress', ...base, remaining: Math.max(0, needed - distinctClientsWithNotes), trialEndsAt: s.trialEndsAt };
  }

  /** Grant one free month (P5-6 referral) by pushing the trial end out 30 days.
   *  Returns false if the account doesn't exist — so an invalid referrer credits
   *  no one. */
  async grantReferralMonth(userId: string): Promise<boolean> {
    const s = await this.subs.get(userId);
    if (!s) return false;
    await this.subs.update(userId, { trialEndsAt: s.trialEndsAt + 30 * DAY_MS });
    return true;
  }

  async entitlement(userId: string, nowMs: number): Promise<Entitlement> {
    const s = await this.subs.get(userId);
    if (!s) return { entitled: false, status: 'none', trialEndsAt: 0 };
    if (s.status === 'active') return { entitled: true, status: 'active', trialEndsAt: s.trialEndsAt };
    if (s.status === 'trialing' && nowMs < s.trialEndsAt) return { entitled: true, status: 'trialing', trialEndsAt: s.trialEndsAt };
    const status = s.status === 'trialing' ? 'trial_expired' : s.status;
    return { entitled: false, status, trialEndsAt: s.trialEndsAt };
  }

  async checkout(userId: string, email: string, plan: Plan = 'monthly'): Promise<{ url: string }> {
    const session = await this.stripe.createCheckoutSession(userId, email, plan);
    return { url: session.url };
  }

  /** Process a Stripe webhook. Returns the HTTP status to reply with. */
  async handleWebhook(payload: string, signature: string): Promise<number> {
    const event = this.stripe.constructEvent(payload, signature);
    if (!event) return 400; // invalid signature → rejected
    if (await this.events.seen(event.id)) return 200; // idempotent replay
    await this.events.record(event.id);

    if (event.type === 'checkout.session.completed' && event.userId) {
      await this.subs.update(event.userId, {
        status: 'active',
        stripeCustomerId: event.customerId ?? null,
        stripeSubscriptionId: event.subscriptionId ?? null,
      });
    } else if (event.type === 'customer.subscription.deleted' && event.customerId) {
      const s = await this.subs.findByCustomerId(event.customerId);
      if (s) await this.subs.update(s.userId, { status: 'canceled' });
    } else if (event.type === 'invoice.payment_failed' && event.customerId) {
      const s = await this.subs.findByCustomerId(event.customerId);
      if (s) await this.subs.update(s.userId, { status: 'past_due' });
    }
    return 200;
  }
}
