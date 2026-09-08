import type { CustomerDetails, Plan, StripeCheckout, StripeGateway, StripeWebhookEvent } from '../../ports/billing.js';

/**
 * Local stand-in for Stripe (test mode). Checkout returns a fake URL; webhook
 * verification checks the signature equals the configured secret and parses the
 * event JSON. The real Stripe SDK is wired at deploy — TEST MODE ONLY.
 */
export class StubStripeGateway implements StripeGateway {
  constructor(private readonly webhookSecret = 'whsec_test') {}

  /** Recorded so tests can assert what the app supplied to Stripe (name/company/metadata sync). */
  readonly customers: Array<{ userId: string; details: CustomerDetails }> = [];
  readonly updates: Array<{ customerId: string; details: CustomerDetails }> = [];

  /** Recorded so a test can assert TRN collection is gated on VAT registration. */
  readonly taxIdCollected: boolean[] = [];

  async createCheckoutSession(userId: string, _email: string, plan: Plan = 'monthly', details: CustomerDetails & { existingCustomerId?: string; collectTaxId?: boolean } = {}): Promise<StripeCheckout> {
    const customerId = details.existingCustomerId ?? `cus_test_${userId}`;
    if (!details.existingCustomerId) this.customers.push({ userId, details: { name: details.name, company: details.company } });
    this.taxIdCollected.push(details.collectTaxId === true);
    return { url: `https://checkout.stripe.test/session?ref=${userId}&plan=${plan}`, sessionId: `cs_test_${userId}`, customerId };
  }

  async updateCustomer(customerId: string, details: CustomerDetails): Promise<void> {
    this.updates.push({ customerId, details });
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
