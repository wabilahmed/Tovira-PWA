/**
 * Ports for monetization (P5-1/P5-2). Stripe is TEST MODE ONLY locally; webhooks
 * are the source of truth for subscription state — a client-side "success"
 * redirect must never grant access on its own.
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/** [BILLING-DUNNING · D3–D7] The failed-payment lifecycle, distinct from `status`. */
export type BillingState = 'active' | 'payment_failed' | 'suspended' | 'ended';

export interface SubscriptionRecord {
  userId: string;
  status: SubscriptionStatus;
  /** [BILLING-DUNNING] The failed-payment state machine. 'active' until a renewal charge fails. */
  billingState: BillingState;
  /** Day-0 anchor of a failed-payment episode (epoch ms); null when active. Stamped ONCE, cleared on
   *  recovery — a replayed/repeat failure never restarts it (the 7/30-day clocks read this). */
  firstFailedAt: number | null;
  /** Last app-driven retry (invoices.pay), epoch ms — so the daily job fires at most once per day. */
  lastRetryAt: number | null;
  /** The unpaid invoice to retry, and its Stripe hosted page where the rep pays + completes 3DS. */
  openInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  /** Failure counts, split so 3DS/authentication_required is reported apart from hard declines (ruling 2). */
  hardDeclineCount: number;
  authRequiredCount: number;
  /** [D8] retention-warning flags + when the subscription ended (the 90-day deletion clock). */
  deletionWarned30d: boolean;
  deletionWarned7d: boolean;
  endedAt: number | null;
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
  billingState?: BillingState;
  firstFailedAt?: number | null;
  lastRetryAt?: number | null;
  openInvoiceId?: string | null;
  hostedInvoiceUrl?: string | null;
  hardDeclineCount?: number;
  authRequiredCount?: number;
  deletionWarned30d?: boolean;
  deletionWarned7d?: boolean;
  endedAt?: number | null;
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
  /** [BILLING-DUNNING] Accounts with a running failed-payment clock (payment_failed or suspended) —
   *  drives the daily retry/reminder/suspend/end job. */
  listInDunning(): Promise<SubscriptionRecord[]>;
  /** [D8] Ended subscriptions — drives the 90-day retention deletion + its two warning emails. */
  listEnded(): Promise<SubscriptionRecord[]>;
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
  /** [USAGE-ALLOWANCE · D12] Checkout mode — 'payment' marks a one-time top-up vs a 'subscription'. */
  mode?: 'subscription' | 'payment';
  /** [USAGE-ALLOWANCE · D12] The top-up product id (from checkout metadata), on a completed top-up. */
  topUpOptionId?: string;
  /** [BILLING-DUNNING · ruling 2] On invoice.payment_failed: the failure code. 'authentication_required'
   *  (3DS) is counted + reported apart from hard declines; the state-machine treatment is identical. */
  paymentFailureCode?: string;
  /** [BILLING-DUNNING · ruling 2] The Stripe hosted invoice page — where the rep pays the open invoice
   *  and completes 3DS. Linked from every failed-payment email + banner. */
  hostedInvoiceUrl?: string;
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
  /** [USAGE-ALLOWANCE · D6/D12] Open a ONE-TIME (mode:'payment') checkout for a top-up: `amountAed` is
   *  what the rep pays; `topUpOptionId` is carried in metadata so the webhook can credit the right
   *  allowance exactly once. Test mode only — the owner provisions live top-up products. */
  createTopUpCheckout(
    userId: string,
    email: string,
    topUpOptionId: string,
    amountAed: number,
    details?: { existingCustomerId?: string },
  ): Promise<StripeCheckout>;
  /** [TASK 3] Open a Stripe Customer Portal session for an existing customer — the rep manages their
   *  subscription there: cancel (at period end), update the payment method, and see invoice history.
   *  `returnUrl` is where Stripe sends them back (the app's Billing page). Test mode only. */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verify + parse a webhook; returns null if the signature is invalid. */
  constructEvent(payload: string, signature: string): StripeWebhookEvent | null;
  /** [BILLING-DUNNING · D6] App-driven daily retry of an open invoice (Stripe's built-in retries can't do
   *  daily-for-30, finding 4). Attempts an off-session charge. Returns 'paid' on success, 'authentication
   *  _required' when the card needs 3DS (the rep must pay via the hosted page — ruling 2), or 'failed' on
   *  a hard decline. Never throws for a decline — only truly unexpected errors propagate. */
  payInvoice(invoiceId: string): Promise<'paid' | 'authentication_required' | 'failed'>;
}
