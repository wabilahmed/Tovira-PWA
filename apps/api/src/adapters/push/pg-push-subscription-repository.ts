import type { Pool } from 'pg';
import type { PushSubscription, PushSubscriptionRepository } from '../../ports/push.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PgPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async save(userId: string, subscription: PushSubscription): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
      );
    });
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
      return (rows as unknown as Row[]).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
    });
  }
}
