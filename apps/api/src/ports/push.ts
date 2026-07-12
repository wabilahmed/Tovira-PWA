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
