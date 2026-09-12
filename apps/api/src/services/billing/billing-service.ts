import type {
  CustomerDetails,
  Plan,
  StripeGateway,
  SubscriptionRepository,
  TrialGrantRepository,
  WebhookEventRepository,
} from '../../ports/billing.js';
import type { InvoiceTaxRepository } from '../../ports/invoice-tax-repository.js';
import type { VatPolicy } from './vat.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lifecycle-email hook the webhook fires (payment failed / subscription
 * confirmed / canceled). Keyed by the Stripe event id for idempotency; a failing
 * send must never break the webhook (isolated by BillingService).
 */
export interface BillingEmailHook {
  paymentFailed(userId: string, eventId: string): Promise<void>;
  subscriptionConfirmed(userId: string, eventId: string, renewsAt: number | null): Promise<void>;
  subscriptionCanceled(userId: string, eventId: string): Promise<void>;
}

export interface Entitlement {
  entitled: boolean;
  status: string;
  trialEndsAt: number;
  /** Next renewal date (epoch ms), straight from the webhook. Null when unknown
   *  — the UI shows a renewal line only when this is set (P5-2). */
  renewsAt: number | null;
  /** START of the current billing period (epoch ms) — the spend-cap bucket anchor.
   *  Null for trials / pre-change subs; the caller falls back explicitly (BILLING-PERIOD). */
  periodStart: number | null;
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
    private readonly emailHook?: BillingEmailHook,
    /** [VAT-READY] the tax policy (off by default) — gates customer-TRN collection + treats invoices. */
    private readonly vat?: VatPolicy,
    /** [VAT-BOUNDARY] the frozen per-invoice tax-treatment store. */
    private readonly invoiceTax?: InvoiceTaxRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Fire a lifecycle email without ever letting it break the caller (1d). */
  private async notify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.warn(`[billing] lifecycle email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Every trialing account — drives the trial-ending/ended job (1a). */
  async listTrialing(): Promise<Array<{ userId: string; trialEndsAt: number }>> {
    return this.subs.listTrialing();
  }

  async onSignup(userId: string, email: string, nowMs: number): Promise<void> {
    // [TRIAL-14] Reuse the original grant for this email → no fresh trial on re-signup. The trial is
    // a FLAT config.trialDays (14); there is no usage-gated extension — a rep gets exactly this window.
    const grantedAt = await this.trials.grantOrGet(email.trim().toLowerCase(), nowMs);
    await this.subs.create(userId, grantedAt + this.trialDays * DAY_MS);
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
    if (!s) return { entitled: false, status: 'none', trialEndsAt: 0, renewsAt: null, periodStart: null };
    const renewsAt = s.currentPeriodEnd;
    const periodStart = s.currentPeriodStart;
    if (s.status === 'active') return { entitled: true, status: 'active', trialEndsAt: s.trialEndsAt, renewsAt, periodStart };
    if (s.status === 'trialing' && nowMs < s.trialEndsAt) return { entitled: true, status: 'trialing', trialEndsAt: s.trialEndsAt, renewsAt, periodStart };
    const status = s.status === 'trialing' ? 'trial_expired' : s.status;
    return { entitled: false, status, trialEndsAt: s.trialEndsAt, renewsAt, periodStart };
  }

  async checkout(userId: string, email: string, plan: Plan = 'monthly', details: CustomerDetails = {}): Promise<{ url: string }> {
    // Reuse an existing customer (a returning subscriber) so we don't orphan its metadata/history.
    const existingCustomerId = (await this.subs.get(userId))?.stripeCustomerId ?? undefined;
    // [VAT-INVOICE] collect the customer's tax id (TRN) ONLY when VAT is on — deliberately off until
    // registration, so we never ask for a TRN we can't put on a (non-existent) tax invoice.
    const collectTaxId = this.vat?.registered === true;
    const session = await this.stripe.createCheckoutSession(userId, email, plan, { ...details, existingCustomerId, collectTaxId });
    // Persist the customer id + name now (before the webhook lands) so a Settings change can sync.
    await this.subs.update(userId, {
      ...(session.customerId ? { stripeCustomerId: session.customerId } : {}),
      ...(details.name !== undefined ? { billingName: details.name } : {}),
      ...(details.company !== undefined ? { billingCompany: details.company } : {}),
    });
    return { url: session.url };
  }

  /** [VAT-BOUNDARY] Freeze the tax treatment of a paid invoice: computed from ITS date + the VAT
   *  config in force now, written once. A later config change never rewrites it (recordOnce). No-op
   *  until VAT is wired + the event carries invoice fields. */
  private async recordInvoiceTax(event: { invoiceId?: string; invoiceTotalFils?: number; invoiceCountry?: string; invoiceIssuedAtMs?: number }, userId: string | null): Promise<void> {
    if (!this.vat || !this.invoiceTax || !event.invoiceId || event.invoiceTotalFils === undefined) return;
    const issuedAtMs = event.invoiceIssuedAtMs ?? this.now();
    const t = this.vat.treat({ dateMs: issuedAtMs, country: event.invoiceCountry ?? null, totalFils: event.invoiceTotalFils });
    await this.invoiceTax.recordOnce({
      invoiceId: event.invoiceId, userId, issuedAtMs, country: event.invoiceCountry ?? null,
      totalFils: t.totalFils, taxInvoice: t.taxInvoice, zeroRated: t.zeroRated,
      netFils: t.netFils, vatFils: t.vatFils, rate: t.rate, trn: t.trn,
    });
  }

  /** Re-read a frozen invoice tax record (the treatment never changes when config flips). */
  invoiceTaxRecord(invoiceId: string): Promise<import('../../ports/invoice-tax-repository.js').InvoiceTaxRecord | null> {
    return this.invoiceTax ? this.invoiceTax.get(invoiceId) : Promise.resolve(null);
  }

  /** Set the billing name/company (Settings) and sync it to the Stripe customer so the invoice
   *  reflects it. No-op sync if no customer exists yet — checkout will carry it then (INVOICE-DATA). */
  async setBillingName(userId: string, details: CustomerDetails): Promise<void> {
    await this.subs.update(userId, {
      ...(details.name !== undefined ? { billingName: details.name } : {}),
      ...(details.company !== undefined ? { billingCompany: details.company } : {}),
    });
    const s = await this.subs.get(userId);
    if (s?.stripeCustomerId) await this.stripe.updateCustomer(s.stripeCustomerId, details);
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
        // Only stamp the period dates when the webhook actually carries them —
        // never invent them (P5-2 / BILLING-PERIOD). A plan change issues a NEW period;
        // stamping its start rolls the spend-cap bucket forward cleanly (old spend stays
        // in the old bucket, the new period starts at zero).
        ...(event.currentPeriodEnd !== undefined ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
        ...(event.currentPeriodStart !== undefined ? { currentPeriodStart: event.currentPeriodStart } : {}),
      });
      if (this.emailHook) await this.notify(() => this.emailHook!.subscriptionConfirmed(event.userId!, event.id, event.currentPeriodEnd ?? null));
    } else if (event.type === 'invoice.payment_succeeded' && event.customerId) {
      // A successful renewal: keep access active and advance the renewal date.
      const s = await this.subs.findByCustomerId(event.customerId);
      if (s) {
        await this.subs.update(s.userId, {
          status: 'active',
          ...(event.currentPeriodEnd !== undefined ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
          ...(event.currentPeriodStart !== undefined ? { currentPeriodStart: event.currentPeriodStart } : {}),
        });
        await this.recordInvoiceTax(event, s.userId);
      }
    } else if (event.type === 'customer.subscription.deleted' && event.customerId) {
      const s = await this.subs.findByCustomerId(event.customerId);
      if (s) {
        await this.subs.update(s.userId, { status: 'canceled' });
        if (this.emailHook) await this.notify(() => this.emailHook!.subscriptionCanceled(s.userId, event.id));
      }
    } else if (event.type === 'invoice.payment_failed' && event.customerId) {
      const s = await this.subs.findByCustomerId(event.customerId);
      if (s) {
        await this.subs.update(s.userId, { status: 'past_due' });
        if (this.emailHook) await this.notify(() => this.emailHook!.paymentFailed(s.userId, event.id));
      }
    }
    return 200;
  }
}
