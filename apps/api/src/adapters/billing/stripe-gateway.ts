import Stripe from 'stripe';
import type { CustomerDetails, Plan, StripeCheckout, StripeGateway, StripeWebhookEvent } from '../../ports/billing.js';

/** Minimal Stripe surface we use — lets tests inject a fake (no live calls/keys). */
export interface StripeLike {
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null; id: string }> } };
  customers: {
    create(params: Stripe.CustomerCreateParams): Promise<{ id: string }>;
    update(id: string, params: Stripe.CustomerUpdateParams): Promise<{ id: string }>;
  };
  webhooks: { constructEvent(payload: string, sig: string, secret: string): Stripe.Event };
}

export interface StripeGatewayOptions {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  /** Annual SKU (P5-5). Falls back to the monthly price if unset. */
  annualPriceId?: string;
  successUrl: string;
  cancelUrl: string;
  stripe?: StripeLike;
}

/**
 * Real Stripe (TEST MODE) behind the StripeGateway port (P5-2/P6-2). Checkout
 * creates a real subscription session; webhook verification uses Stripe's
 * signature check — a forged/unsigned event is rejected (returns null).
 */
export class StripeGatewayImpl implements StripeGateway {
  private readonly stripe: StripeLike;

  constructor(private readonly opts: StripeGatewayOptions) {
    this.stripe = opts.stripe ?? (new Stripe(opts.secretKey) as unknown as StripeLike);
  }

  /** metadata: only the Tovira user id (always, so an invoice traces back without matching on email)
   *  and an optional company. NO other PII is sent — email + name are the invoice essentials. */
  private metadataFor(userId: string, company?: string): Record<string, string> {
    return { tovira_user_id: userId, ...(company ? { company } : {}) };
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    plan: Plan = 'monthly',
    details: CustomerDetails & { existingCustomerId?: string } = {},
  ): Promise<StripeCheckout> {
    const price = plan === 'annual' ? this.opts.annualPriceId ?? this.opts.priceId : this.opts.priceId;
    // Create (or reuse) a customer that carries the name + the user-id metadata, so the generated
    // invoice has a name on it and traces back to the account — a bare customer_email has neither.
    const customerId = details.existingCustomerId
      ?? (await this.stripe.customers.create({
        email: email || undefined,
        ...(details.name ? { name: details.name } : {}),
        metadata: this.metadataFor(userId, details.company),
      })).id;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer: customerId,
      client_reference_id: userId,
      success_url: this.opts.successUrl,
      cancel_url: this.opts.cancelUrl,
    });
    return { url: session.url ?? '', sessionId: session.id, customerId };
  }

  async updateCustomer(customerId: string, details: CustomerDetails): Promise<void> {
    await this.stripe.customers.update(customerId, {
      ...(details.name !== undefined ? { name: details.name } : {}),
      // metadata updates MERGE in Stripe, so this sets company without dropping tovira_user_id.
      ...(details.company !== undefined ? { metadata: { company: details.company } } : {}),
    });
  }

  constructEvent(payload: string, signature: string): StripeWebhookEvent | null {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.opts.webhookSecret);
    } catch {
      return null; // invalid/forged signature
    }
    const obj = event.data.object as unknown as Record<string, unknown>;
    // Stripe sends period ends in SECONDS. Subscriptions expose current_period_end;
    // invoices expose period_end. Convert to epoch ms; leave undefined otherwise.
    const periodEndSec = typeof obj.current_period_end === 'number' ? obj.current_period_end
      : typeof obj.period_end === 'number' ? obj.period_end : undefined;
    // Period START: subscriptions expose current_period_start; invoices expose period_start.
    const periodStartSec = typeof obj.current_period_start === 'number' ? obj.current_period_start
      : typeof obj.period_start === 'number' ? obj.period_start : undefined;
    return {
      id: event.id,
      type: event.type,
      userId: typeof obj.client_reference_id === 'string' ? obj.client_reference_id : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
      ...(periodEndSec !== undefined ? { currentPeriodEnd: periodEndSec * 1000 } : {}),
      ...(periodStartSec !== undefined ? { currentPeriodStart: periodStartSec * 1000 } : {}),
    };
  }
}
