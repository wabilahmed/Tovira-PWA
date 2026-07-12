import type { StripeCheckout, StripeGateway, StripeWebhookEvent } from '../../ports/billing.js';

/**
 * Local stand-in for Stripe (test mode). Checkout returns a fake URL; webhook
 * verification checks the signature equals the configured secret and parses the
 * event JSON. The real Stripe SDK is wired at deploy — TEST MODE ONLY.
 */
export class StubStripeGateway implements StripeGateway {
  constructor(private readonly webhookSecret = 'whsec_test') {}

  async createCheckoutSession(userId: string): Promise<StripeCheckout> {
    return { url: `https://checkout.stripe.test/session?ref=${userId}`, sessionId: `cs_test_${userId}` };
  }

  constructEvent(payload: string, signature: string): StripeWebhookEvent | null {
    if (signature !== this.webhookSecret) return null; // invalid signature → rejected
    try {
      const event = JSON.parse(payload) as StripeWebhookEvent;
      return event.id && event.type ? event : null;
    } catch {
      return null;
    }
  }
}
