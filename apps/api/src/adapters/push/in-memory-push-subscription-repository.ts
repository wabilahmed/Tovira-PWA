import type { PushSubscription, PushSubscriptionRepository } from '../../ports/push.js';

/** In-memory push subscriptions for tests. */
export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byUser = new Map<string, Map<string, PushSubscription>>();

  async save(userId: string, subscription: PushSubscription): Promise<void> {
    const subs = this.byUser.get(userId) ?? new Map();
    subs.set(subscription.endpoint, subscription); // dedupe by endpoint
    this.byUser.set(userId, subs);
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return [...(this.byUser.get(userId)?.values() ?? [])];
  }
}
