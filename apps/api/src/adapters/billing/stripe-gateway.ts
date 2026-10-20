import Stripe from 'stripe';
import type { CheckoutSessionInfo, CustomerDetails, Plan, PlanInterval, PlanPriceCheck, StripeCheckout, StripeGateway, StripeWebhookEvent } from '../../ports/billing.js';
import { PriceIntervalMismatchError } from '../../ports/billing.js';

/** Minimal Stripe surface we use — lets tests inject a fake (no live calls/keys). */
export interface StripeLike {
  checkout: { sessions: {
    create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null; id: string }>;
    // [P14-2] Retrieve a session for the server-side success confirmation (payment status + who it was for).
    retrieve(id: string): Promise<{
      client_reference_id: string | null;
      payment_status: string | null;
      status: string | null;
      mode: string | null;
      customer: string | { id: string } | null;
      subscription: string | { id: string } | null;
      metadata?: Record<string, string> | null;
    }>;
  } };
  customers: {
    create(params: Stripe.CustomerCreateParams): Promise<{ id: string }>;
    update(id: string, params: Stripe.CustomerUpdateParams): Promise<{ id: string }>;
  };
  // [PAY-04] Read a price to verify its recurring interval before charging on it.
  prices: { retrieve(id: string): Promise<{ recurring: { interval: string } | null }> };
  invoices: { pay(id: string, params?: Stripe.InvoicePayParams): Promise<{ status: string | null }> };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
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

/** [P29] Stripe's answer for a customer id it can't find in THIS mode — a test-mode id used with a live key
 *  ("No such customer: 'cus_…'; a similar object exists in test mode, but a live mode key was used…") or a
 *  deleted customer: an invalid-request `resource_missing` error on the `customer` parameter. */
export function isMissingCustomer(err: unknown): boolean {
  const e = err as { code?: unknown; param?: unknown; message?: unknown; raw?: { code?: unknown; param?: unknown } } | null;
  const code = e?.code ?? e?.raw?.code;
  const param = e?.param ?? e?.raw?.param;
  return code === 'resource_missing' && (param === 'customer' || (typeof e?.message === 'string' && e.message.startsWith('No such customer')));
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

  // [PAY-04] Price intervals don't change under us, so cache each verified lookup — a steady-state
  // checkout costs no extra Stripe call.
  private readonly intervalCache = new Map<string, string | null>();

  private planInterval(plan: Plan): PlanInterval {
    return plan === 'annual' ? 'year' : 'month';
  }

  /** The recurring interval of a price (null if not recurring), cached after the first lookup. */
  private async priceInterval(priceId: string): Promise<string | null> {
    const cached = this.intervalCache.get(priceId);
    if (cached !== undefined) return cached;
    const price = await this.stripe.prices.retrieve(priceId);
    const interval = price.recurring?.interval ?? null;
    this.intervalCache.set(priceId, interval);
    return interval;
  }

  /** [PAY-04] Refuse the checkout unless the price's interval matches the plan. A lookup failure fails
   *  CLOSED (refuse) — never charge on a price we couldn't verify. */
  private async assertPlanPrice(priceId: string, plan: Plan): Promise<void> {
    const expected = this.planInterval(plan);
    let interval: string | null;
    try {
      interval = await this.priceInterval(priceId);
    } catch (err) {
      console.error(`[billing][PAY-04] could not verify Stripe price ${priceId}; refusing ${plan} checkout`, err);
      throw new PriceIntervalMismatchError(priceId, expected, null);
    }
    if (interval !== expected) {
      console.error(`[billing][PAY-04] price ${priceId} interval is ${interval ?? 'none'}, expected ${expected} for the ${plan} plan — refusing checkout`);
      throw new PriceIntervalMismatchError(priceId, expected, interval);
    }
  }

  async verifyPlanPrices(): Promise<PlanPriceCheck[]> {
    const plans: Array<{ plan: Plan; priceId: string }> = [
      { plan: 'monthly', priceId: this.opts.priceId },
      { plan: 'annual', priceId: this.opts.annualPriceId ?? this.opts.priceId },
    ];
    const out: PlanPriceCheck[] = [];
    for (const { plan, priceId } of plans) {
      const expected = this.planInterval(plan);
      try {
        const interval = await this.priceInterval(priceId);
        out.push({ plan, priceId, expected, interval, ok: interval === expected });
      } catch {
        out.push({ plan, priceId, expected, interval: null, ok: false, error: 'lookup_failed' });
      }
    }
    return out;
  }

  /** [P29] Run `call` with the stored customer; if Stripe can't find that customer in this mode (a test-mode
   *  id after the switch to live, or a deleted one), create a fresh customer and retry ONCE. Returns the
   *  customer id actually used, so the caller stores the replacement. Any other error propagates. */
  private async withCustomer<T>(existing: string | undefined, create: () => Promise<string>, call: (customerId: string) => Promise<T>): Promise<{ result: T; customerId: string }> {
    const customerId = existing ?? (await create());
    try {
      return { result: await call(customerId), customerId };
    } catch (err) {
      if (!existing || !isMissingCustomer(err)) throw err;
      const fresh = await create();
      console.warn(`[billing][P29] stored Stripe customer ${existing} does not exist in this mode — created ${fresh} and retried`);
      return { result: await call(fresh), customerId: fresh };
    }
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
    // [PAY-04] Verify the price bills at the right cadence BEFORE creating a customer or a session, so a
    // misconfigured yearly SKU (a monthly interval) can never charge a rep AED 2,990 every month.
    await this.assertPlanPrice(price, plan);
    // Create (or reuse) a customer that carries the name + the user-id metadata, so the generated
    // invoice has a name on it and traces back to the account — a bare customer_email has neither.
    const newCustomer = async () => (await this.stripe.customers.create({
      email: email || undefined,
      ...(details.name ? { name: details.name } : {}),
      metadata: this.metadataFor(userId, details.company),
    })).id;
    const { result: session, customerId } = await this.withCustomer(details.existingCustomerId, newCustomer, (customerId) => this.stripe.checkout.sessions.create({
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
      // [BILL-13] Carry the plan onto the success page so it can name it ("subscribed to the Yearly plan").
      // [P14-2] Also carry session_id so the page can confirm THIS payment server-side (safety net for a
      // delayed/lost webhook). Stripe substitutes {CHECKOUT_SESSION_ID} on redirect.
      success_url: `${this.opts.successUrl}${this.opts.successUrl.includes('?') ? '&' : '?'}plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.opts.cancelUrl,
    }));
    return { url: session.url ?? '', sessionId: session.id, customerId };
  }

  async createTopUpCheckout(
    userId: string,
    email: string,
    topUpOptionId: string,
    amountAed: number,
    details: { existingCustomerId?: string; productName?: string } = {},
  ): Promise<StripeCheckout> {
    const newCustomer = async () => (await this.stripe.customers.create({ email: email || undefined, metadata: this.metadataFor(userId) })).id;
    const { result: session, customerId } = await this.withCustomer(details.existingCustomerId, newCustomer, (customerId) => this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(amountAed * 100), // fils
          product_data: { name: details.productName ?? `Tovira extra usage (${topUpOptionId})` }, // [P37] e.g. "Tovira extra usage: +50%"
        },
      }],
      customer: customerId,
      client_reference_id: userId,
      // The webhook credits the right allowance by reading this metadata. On the session AND the
      // payment_intent so it survives either event shape.
      metadata: { tovira_user_id: userId, topup_option_id: topUpOptionId },
      payment_intent_data: { metadata: { tovira_user_id: userId, topup_option_id: topUpOptionId } },
      // [BILL-13] Same return page, tagged so it reads "top-up added" (not "subscribed") and skips the
      // subscription-active poll — a top-up doesn't change subscription status.
      success_url: `${this.opts.successUrl}${this.opts.successUrl.includes('?') ? '&' : '?'}topup=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.opts.cancelUrl,
    }));
    return { url: session.url ?? '', sessionId: session.id, customerId };
  }

  async updateCustomer(customerId: string, details: CustomerDetails): Promise<void> {
    try {
      await this.stripe.customers.update(customerId, {
        ...(details.name !== undefined ? { name: details.name } : {}),
        // metadata updates MERGE in Stripe, so this sets company without dropping tovira_user_id.
        ...(details.company !== undefined ? { metadata: { company: details.company } } : {}),
      });
    } catch (err) {
      // [P29] A test-mode (or deleted) customer can't be synced — nothing to update; the name is saved in the
      // app and the next checkout's fresh customer carries it. Never fail the Settings save over it.
      if (!isMissingCustomer(err)) throw err;
      console.warn(`[billing][P29] name sync skipped: Stripe customer ${customerId} does not exist in this mode`);
    }
  }

  /** [BILLING-DUNNING · D6] Off-session daily retry. A decline/3DS is NOT exceptional here — map Stripe's
   *  error code to a result; only unexpected (non-StripeError) failures propagate. */
  async payInvoice(invoiceId: string): Promise<'paid' | 'authentication_required' | 'failed'> {
    try {
      const inv = await this.stripe.invoices.pay(invoiceId, { off_session: true });
      return inv.status === 'paid' ? 'paid' : 'failed';
    } catch (err) {
      const code = (err as { code?: string; raw?: { code?: string } })?.code ?? (err as { raw?: { code?: string } })?.raw?.code;
      if (code === 'authentication_required') return 'authentication_required';
      // card_declined / insufficient_funds / etc. → a hard failure the retry schedule keeps trying.
      if (err instanceof Error && 'type' in err) return 'failed';
      throw err; // a genuinely unexpected error (network/bug) — let it surface
    }
  }

  /** [TASK 3] Stripe-hosted Customer Portal: cancel at period end, update the card, invoice history. The
   *  behaviours shown are configured in the Stripe Dashboard (Billing → Customer portal), not here. */
  async createPortalSession(customerId: string, returnUrl: string, owner?: { userId: string; email: string }): Promise<{ url: string; customerId?: string }> {
    // [P29] A stored test-mode customer → a fresh customer in this mode (only when we know whose it is).
    const newCustomer = async () => (await this.stripe.customers.create({ email: owner?.email || undefined, metadata: this.metadataFor(owner!.userId) })).id;
    const open = (customer: string) => this.stripe.billingPortal.sessions.create({ customer, return_url: returnUrl });
    if (!owner) return { url: (await open(customerId)).url };
    const { result, customerId: used } = await this.withCustomer(customerId, newCustomer, open);
    return { url: result.url, ...(used !== customerId ? { customerId: used } : {}) };
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
    // [USAGE-ALLOWANCE · D12] checkout mode + the top-up option id (session or payment_intent metadata).
    const meta = (obj.metadata as Record<string, unknown> | null | undefined) ?? undefined;
    const topUpOptionId = meta && typeof meta.topup_option_id === 'string' ? meta.topup_option_id : undefined;
    const mode = obj.mode === 'payment' || obj.mode === 'subscription' ? obj.mode : undefined;
    // [BILLING-DUNNING · ruling 2] On invoice.payment_failed: the hosted page (pay + 3DS) and the failure
    // code. Stripe puts the decline code on the invoice's last_finalization_error, or on the attached
    // PaymentIntent's last_payment_error; 'authentication_required' means 3DS is needed.
    const hostedInvoiceUrl = typeof obj.hosted_invoice_url === 'string' ? obj.hosted_invoice_url : undefined;
    const finErr = obj.last_finalization_error as { code?: unknown } | null | undefined;
    const payErr = (obj.last_payment_error ?? (obj.payment_intent as { last_payment_error?: unknown } | undefined)?.last_payment_error) as { code?: unknown } | null | undefined;
    const paymentFailureCode = typeof payErr?.code === 'string' ? payErr.code : typeof finErr?.code === 'string' ? finErr.code : undefined;
    return {
      id: event.id,
      type: event.type,
      userId: typeof obj.client_reference_id === 'string' ? obj.client_reference_id
        : meta && typeof meta.tovira_user_id === 'string' ? meta.tovira_user_id : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
      ...(periodEndSec !== undefined ? { currentPeriodEnd: periodEndSec * 1000 } : {}),
      ...(periodStartSec !== undefined ? { currentPeriodStart: periodStartSec * 1000 } : {}),
      ...(isInvoice && typeof obj.id === 'string' ? { invoiceId: obj.id } : {}),
      ...(isInvoice && totalMinor !== undefined ? { invoiceTotalFils: totalMinor } : {}),
      ...(isInvoice && custAddr && typeof custAddr.country === 'string' ? { invoiceCountry: custAddr.country } : {}),
      ...(isInvoice && createdSec !== undefined ? { invoiceIssuedAtMs: createdSec * 1000 } : {}),
      ...(mode ? { mode } : {}),
      ...(topUpOptionId ? { topUpOptionId } : {}),
      ...(hostedInvoiceUrl ? { hostedInvoiceUrl } : {}),
      ...(paymentFailureCode ? { paymentFailureCode } : {}),
    };
  }

  // [P14-2] Server-side success confirmation. A session is 'paid' when Stripe reports payment_status
  // 'paid' (or 'no_payment_required') / status 'complete'. The id ties back to our user via
  // client_reference_id (set at checkout). Returns null when Stripe can't find/parse the session.
  async retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | null> {
    if (!sessionId) return null;
    try {
      const s = await this.stripe.checkout.sessions.retrieve(sessionId);
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;
      const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null;
      const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required' || s.status === 'complete';
      const topUpOptionId = s.metadata && typeof s.metadata.topup_option_id === 'string' ? s.metadata.topup_option_id : undefined;
      return {
        userId: s.client_reference_id ?? null,
        paid,
        mode: s.mode === 'payment' ? 'payment' : 'subscription',
        customerId,
        subscriptionId,
        ...(topUpOptionId ? { topUpOptionId } : {}),
      };
    } catch {
      return null; // unknown / invalid session id
    }
  }
}
