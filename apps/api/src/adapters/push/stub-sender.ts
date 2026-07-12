import type { PushPayload, PushSender, PushSubscription } from '../../ports/push.js';

/** Records pushes instead of delivering them (local dev + tests). */
export class StubPushSender implements PushSender {
  readonly sent: Array<{ subscription: PushSubscription; payload: PushPayload }> = [];
  async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
    this.sent.push({ subscription, payload });
  }
}
