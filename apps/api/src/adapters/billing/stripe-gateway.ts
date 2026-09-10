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
    details: CustomerDetails & { existingCustomerId?: string; collectTaxId?: boolean } = {},
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
      // [PROMO-CODES] Let Stripe-hosted Checkout accept a promotion code and ENFORCE it — validity,
      // expiry, max_redemptions, and duration:forever all live in Stripe. We never accept or forward
      // a code ourselves, so a bad/exhausted code is rejected inline by Stripe and the rep can still
      // subscribe at full price; nothing here can block the purchase. The discount then flows through
      // to the invoice total (post-discount), which is what our VAT decomposition reads.
      allow_promotion_codes: true,
      // [VAT-INVOICE] when VAT is registered, collect the customer's TRN AND require a billing
      // address — the country is what decides UAE-taxed vs non-UAE zero-rated, and our frozen
      // invoice_tax record reads it from invoice.customer_address. Without this the country is
      // usually unknown, which defaults to UAE/taxed and would wrongly tax export customers.
      ...(details.collectTaxId ? { tax_id_collection: { enabled: true }, billing_address_collection: 'required' as const } : {}),
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
    // [VAT] invoice fields on invoice.* events: id, total (fils = Stripe's smallest-unit amount),
    // the customer's country (for zero-rating), and the supply date.
    const isInvoice = event.type.startsWith('invoice.');
    const custAddr = obj.customer_address as { country?: unknown } | null | undefined;
    const totalMinor = typeof obj.total === 'number' ? obj.total : typeof obj.amount_paid === 'number' ? obj.amount_paid : undefined;
    const createdSec = typeof obj.created === 'number' ? obj.created : undefined;
    return {
      id: event.id,
      type: event.type,
      userId: typeof obj.client_reference_id === 'string' ? obj.client_reference_id : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
      ...(periodEndSec !== undefined ? { currentPeriodEnd: periodEndSec * 1000 } : {}),
      ...(periodStartSec !== undefined ? { currentPeriodStart: periodStartSec * 1000 } : {}),
      ...(isInvoice && typeof obj.id === 'string' ? { invoiceId: obj.id } : {}),
      ...(isInvoice && totalMinor !== undefined ? { invoiceTotalFils: totalMinor } : {}),
      ...(isInvoice && custAddr && typeof custAddr.country === 'string' ? { invoiceCountry: custAddr.country } : {}),
      ...(isInvoice && createdSec !== undefined ? { invoiceIssuedAtMs: createdSec * 1000 } : {}),
    };
  }
}
