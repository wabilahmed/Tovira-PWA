/**
 * [P44-2] The ops cost report's sources. Cross-tenant cost accounting for OPS (like model_call_events): written
 * system-side, read only behind the ops token, never a rep query path.
 *
 *  - transcription_events: one row per completed voice-note transcription (audio seconds, model), so the Groq
 *    cost can be worked out per user and period. Recorded from P44-2 on; earlier voice notes have no row.
 *  - revenue_events: one row per paid Stripe object (a subscription invoice, or a top-up Checkout session),
 *    keyed by its Stripe id (idempotent), with the amount actually paid and the billing period it belongs to.
 */
export interface TranscriptionEvent {
  userId: string;
  /** The rep's billing-period key at the time (the same bucketing as Claude spend). */
  periodKey: string | null;
  model: string;
  audioSeconds: number;
  /** true = derived from the recording's byte length (the provider returned no duration). */
  estimated: boolean;
  at: number;
}

export type RevenueKind = 'subscription' | 'topup';
export interface RevenueEvent {
  /** Stripe invoice id (subscription) or Checkout session id (top-up). Unique: a replay is a no-op. */
  stripeId: string;
  userId: string | null;
  kind: RevenueKind;
  /** Stripe's smallest unit (fils for AED). */
  amountFils: number;
  currency: string;
  paidAt: number;
  /** Subscription: `p:<the invoice line's period start>`; top-up: the rep's period key at payment. */
  periodKey: string | null;
}

/** A report's grouping: the rep's billing period (default), or the calendar month (UTC) for invoice matching. */
export type CostView = 'period' | 'month';

export interface ClaudeCostRow { userId: string; key: string; spendClass: string; aed: number; calls: number }
export interface VoiceRow { userId: string; key: string; model: string; audioSeconds: number; estimated: boolean }
export interface RevenueRow { userId: string; key: string; kind: RevenueKind; fils: number }
/** A paid subscription invoice recorded before revenue_events existed (from invoice_tax): no period of its own. */
export interface LegacyInvoiceRow { userId: string; issuedAt: number; fils: number }
export interface CapSpendRow { userId: string; periodKey: string; aed: number }
/** A rep's subscription, for the plan column. Emails are NOT read here: users-table access stays in the audited
 *  user repository ([USERS-GUARD]); the report looks each email up by id. */
export interface SubscriptionRow { userId: string; status: string | null; periodStart: number | null; periodEnd: number | null }

export interface CostReportStore {
  recordTranscription(e: TranscriptionEvent): Promise<void>;
  recordRevenue(e: RevenueEvent): Promise<void>;
  claude(view: CostView): Promise<ClaudeCostRow[]>;
  voice(view: CostView): Promise<VoiceRow[]>;
  revenue(view: CostView): Promise<RevenueRow[]>;
  legacyInvoices(): Promise<LegacyInvoiceRow[]>;
  /** Claude spend as the cap counts it (spend_ledger), per billing period. */
  capSpend(): Promise<CapSpendRow[]>;
  subscriptions(): Promise<SubscriptionRow[]>;
  /** When voice recording began (the first transcription_events row), or null if none yet. */
  voiceRecordedSince(): Promise<number | null>;
}
