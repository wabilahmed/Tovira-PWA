import webpush from 'web-push';
import type { PushPayload, PushSender, PushSubscription } from '../../ports/push.js';

/** Injectable send fn (so tests don't hit a real push service). */
export type WebPushSendFn = (subscription: webpush.PushSubscription, payload: string) => Promise<unknown>;

export interface WebPushOptions {
  publicKey: string;
  privateKey: string;
  subject: string;
  sendFn?: WebPushSendFn;
}

/**
 * Real Web Push over VAPID (P3-6/P6-2), same PushSender port as the stub. A
 * failed send throws — callers already treat push as best-effort with the in-app
 * list as the fallback.
 */
export class WebPushSender implements PushSender {
  private readonly sendFn: WebPushSendFn;

  constructor(opts: WebPushOptions) {
    if (opts.publicKey && opts.privateKey) {
      webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
    }
    this.sendFn = opts.sendFn ?? ((sub, payload) => webpush.sendNotification(sub, payload));
  }

  async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
    await this.sendFn(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
    );
  }
}
