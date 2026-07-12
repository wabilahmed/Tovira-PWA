import Stripe from 'stripe';
import type { StripeCheckout, StripeGateway, StripeWebhookEvent } from '../../ports/billing.js';

/** Minimal Stripe surface we use — lets tests inject a fake (no live calls/keys). */
export interface StripeLike {
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null; id: string }> } };
  webhooks: { constructEvent(payload: string, sig: string, secret: string): Stripe.Event };
}

export interface StripeGatewayOptions {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
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

  async createCheckoutSession(userId: string, email: string): Promise<StripeCheckout> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: this.opts.priceId, quantity: 1 }],
      customer_email: email || undefined,
      client_reference_id: userId,
      success_url: this.opts.successUrl,
      cancel_url: this.opts.cancelUrl,
    });
    return { url: session.url ?? '', sessionId: session.id };
  }

  constructEvent(payload: string, signature: string): StripeWebhookEvent | null {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.opts.webhookSecret);
    } catch {
      return null; // invalid/forged signature
    }
    const obj = event.data.object as unknown as Record<string, unknown>;
    return {
      id: event.id,
      type: event.type,
      userId: typeof obj.client_reference_id === 'string' ? obj.client_reference_id : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
    };
  }
}
