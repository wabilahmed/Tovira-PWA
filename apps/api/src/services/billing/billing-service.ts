import type {
  StripeGateway,
  SubscriptionRepository,
  TrialGrantRepository,
  WebhookEventRepository,
} from '../../ports/billing.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Entitlement {
  entitled: boolean;
  status: string;
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

  async entitlement(userId: string, nowMs: number): Promise<Entitlement> {
    const s = await this.subs.get(userId);
    if (!s) return { entitled: false, status: 'none', trialEndsAt: 0 };
    if (s.status === 'active') return { entitled: true, status: 'active', trialEndsAt: s.trialEndsAt };
    if (s.status === 'trialing' && nowMs < s.trialEndsAt) return { entitled: true, status: 'trialing', trialEndsAt: s.trialEndsAt };
    const status = s.status === 'trialing' ? 'trial_expired' : s.status;
    return { entitled: false, status, trialEndsAt: s.trialEndsAt };
  }

  async checkout(userId: string, email: string): Promise<{ url: string }> {
    const session = await this.stripe.createCheckoutSession(userId, email);
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
