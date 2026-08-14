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

export interface PushSubscriptionRepository {
  save(userId: string, subscription: PushSubscription): Promise<void>;
  listByUser(userId: string): Promise<PushSubscription[]>;
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
