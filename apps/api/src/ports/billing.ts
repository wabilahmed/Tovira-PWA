/**
 * Ports for monetization (P5-1/P5-2). Stripe is TEST MODE ONLY locally; webhooks
 * are the source of truth for subscription state — a client-side "success"
 * redirect must never grant access on its own.
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface SubscriptionRecord {
  userId: string;
  status: SubscriptionStatus;
  trialEndsAt: number;
  // [TRIAL-14] The usage-gated trial extension is removed (flat 14-day trial), so `trialExtended` is
  // gone from the app model. The DB column subscriptions.trial_extended is now ORPHANED — left in
  // place (not dropped here); see TRIAL-14-REPORT for the follow-up drop-migration decision.
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** End of the current paid period, epoch ms — the renewal date. Null until a
   *  webhook carrying it arrives; never inferred locally (P5-2). */
  currentPeriodEnd: number | null;
  /** START of the current paid period, epoch ms — the spend-cap bucket anchor
   *  (BILLING-PERIOD). Stored straight from the webhook; null for trials and for
   *  subscriptions created before this field existed. NEVER inferred — a null here
   *  means "fall back explicitly", never "compute one that looks authoritative". */
  currentPeriodStart: number | null;
  /** Billing name + optional company synced to the Stripe customer (INVOICE-DATA). Null until set. */
  billingName: string | null;
  billingCompany: string | null;
}

export interface SubscriptionPatch {
  status?: SubscriptionStatus;
  trialEndsAt?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: number | null;
  currentPeriodStart?: number | null;
  billingName?: string | null;
  billingCompany?: string | null;
}

export interface SubscriptionRepository {
  create(userId: string, trialEndsAt: number): Promise<SubscriptionRecord>;
  get(userId: string): Promise<SubscriptionRecord | null>;
  update(userId: string, patch: SubscriptionPatch): Promise<void>;
  findByCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
  /** Every account still on a trial — drives the trial-ending/ended emails. */
  listTrialing(): Promise<Array<{ userId: string; trialEndsAt: number }>>;
}

export interface TrialGrantRepository {
  /** Returns the existing grant time for an email, or records now and returns it. */
  grantOrGet(email: string, nowMs: number): Promise<number>;
}

export interface WebhookEventRepository {
  /** True if this event id was already processed (idempotency). */
  seen(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}

export interface StripeCheckout {
  url: string;
  sessionId: string;
  /** The Stripe customer id created/reused for the session — stored so a Settings name change can
   *  sync to it before the webhook lands (INVOICE-DATA). */
  customerId?: string;
}

/** What the app supplies about a customer so Stripe invoices are correct + traceable (INVOICE-DATA).
 *  The Tovira user id is always attached as metadata; name/company are optional. */
export interface CustomerDetails {
  name?: string;
  company?: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  userId?: string;
  customerId?: string;
  subscriptionId?: string;
  /** current_period_end from the subscription/invoice, epoch ms (the gateway
   *  converts Stripe's seconds). Absent when the event doesn't carry one. */
  currentPeriodEnd?: number;
  /** current_period_start (subscription) / period_start (invoice), epoch ms.
   *  Absent when the event doesn't carry one — then the period start is not stamped. */
  currentPeriodStart?: number;
  /** [VAT] invoice fields, present on invoice.* events — the id, its total (fils), the customer's
   *  country (for zero-rating), and its supply date (drives the tax boundary). */
  invoiceId?: string;
  invoiceTotalFils?: number;
  invoiceCountry?: string;
  invoiceIssuedAtMs?: number;
}

export type Plan = 'monthly' | 'annual';

export interface StripeGateway {
  /** Creates (or reuses `existingCustomerId`) a Stripe customer carrying the Tovira user id as
   *  metadata + any name/company, then opens a subscription checkout for it (INVOICE-DATA). */
  createCheckoutSession(
    userId: string,
    email: string,
    plan: Plan,
    details?: CustomerDetails & { existingCustomerId?: string; collectTaxId?: boolean },
  ): Promise<StripeCheckout>;
  /** Sync a name/company change to an existing Stripe customer (Settings). */
  updateCustomer(customerId: string, details: CustomerDetails): Promise<void>;
  /** Verify + parse a webhook; returns null if the signature is invalid. */
  constructEvent(payload: string, signature: string): StripeWebhookEvent | null;
}
