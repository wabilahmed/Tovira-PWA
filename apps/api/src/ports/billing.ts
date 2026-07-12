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
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface SubscriptionPatch {
  status?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface SubscriptionRepository {
  create(userId: string, trialEndsAt: number): Promise<SubscriptionRecord>;
  get(userId: string): Promise<SubscriptionRecord | null>;
  update(userId: string, patch: SubscriptionPatch): Promise<void>;
  findByCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
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
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  userId?: string;
  customerId?: string;
  subscriptionId?: string;
}

export interface StripeGateway {
  createCheckoutSession(userId: string, email: string): Promise<StripeCheckout>;
  /** Verify + parse a webhook; returns null if the signature is invalid. */
  constructEvent(payload: string, signature: string): StripeWebhookEvent | null;
}
