import type {
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionPatch,
  TrialGrantRepository,
  WebhookEventRepository,
} from '../../ports/billing.js';

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private byUser = new Map<string, SubscriptionRecord>();

  async create(userId: string, trialEndsAt: number): Promise<SubscriptionRecord> {
    const record: SubscriptionRecord = { userId, status: 'trialing', trialEndsAt, stripeCustomerId: null, stripeSubscriptionId: null };
    this.byUser.set(userId, record);
    return record;
  }
  async get(userId: string): Promise<SubscriptionRecord | null> {
    return this.byUser.get(userId) ?? null;
  }
  async update(userId: string, patch: SubscriptionPatch): Promise<void> {
    const s = this.byUser.get(userId);
    if (!s) return;
    Object.assign(s, patch);
  }
  async findByCustomerId(customerId: string): Promise<SubscriptionRecord | null> {
    return [...this.byUser.values()].find((s) => s.stripeCustomerId === customerId) ?? null;
  }
}

export class InMemoryTrialGrantRepository implements TrialGrantRepository {
  private grants = new Map<string, number>();
  async grantOrGet(email: string, nowMs: number): Promise<number> {
    const existing = this.grants.get(email);
    if (existing !== undefined) return existing;
    this.grants.set(email, nowMs);
    return nowMs;
  }
}

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private ids = new Set<string>();
  async seen(eventId: string): Promise<boolean> {
    return this.ids.has(eventId);
  }
  async record(eventId: string): Promise<void> {
    this.ids.add(eventId);
  }
}
