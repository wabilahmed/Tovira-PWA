import { PushSubscriptionGoneError, type PushPayload, type PushSender, type PushSubscription } from '../../ports/push.js';

/** Records pushes instead of delivering them (local dev + tests). */
export class StubPushSender implements PushSender {
  readonly sent: Array<{ subscription: PushSubscription; payload: PushPayload }> = [];
  /** [P46-2] Tests: endpoints the "push service" reports as gone (410). */
  readonly goneEndpoints = new Set<string>();
  async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
    if (this.goneEndpoints.has(subscription.endpoint)) throw new PushSubscriptionGoneError(subscription.endpoint);
    this.sent.push({ subscription, payload });
  }
}
