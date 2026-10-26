/**
 * Port: Web Push (VAPID) — subscriptions + delivery (P3-6). Real delivery is
 * verified on a device in P6-3; locally we build the mechanism with a stub.
 */

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  send(subscription: PushSubscription, payload: PushPayload): Promise<void>;
}

/** [P46-2] The push service says this subscription no longer exists (HTTP 404 / 410): delete it, never retry it. */
export class PushSubscriptionGoneError extends Error {
  constructor(readonly endpoint: string) { super('push subscription gone'); this.name = 'PushSubscriptionGoneError'; }
}

export interface PushSubscriptionRepository {
  save(userId: string, subscription: PushSubscription): Promise<void>;
  listByUser(userId: string): Promise<PushSubscription[]>;
  /** [P46-2] Remove one device's subscription (gone at the push service). */
  remove(userId: string, endpoint: string): Promise<void>;
}

/**
 * The silence budget's ledger: how many pushes a rep has been sent on a given
 * day (P4-SILENCE). Counts ALERTS, not device fan-out — the cap protects the
 * rep's attention, not the wire. Keyed per user per UTC day.
 */
export interface PushBudgetRepository {
  countSent(userId: string, dayIso: string): Promise<number>;
  recordSent(userId: string, dayIso: string, count: number): Promise<void>;
}
