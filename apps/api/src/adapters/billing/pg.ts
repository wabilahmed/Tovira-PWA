import type { Pool } from 'pg';
import type {
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionPatch,
  SubscriptionStatus,
  TrialGrantRepository,
  WebhookEventRepository,
} from '../../ports/billing.js';

/**
 * Billing tables are SYSTEM-managed (webhooks have no user context), so they are
 * not RLS-scoped; queries filter by user_id / customer explicitly.
 */

interface SubRow {
  user_id: string;
  status: string;
  trial_ends_at: Date;
  trial_extended: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
}
const SUB_COLS = 'user_id, status, trial_ends_at, trial_extended, stripe_customer_id, stripe_subscription_id, current_period_end';
function toSub(r: SubRow): SubscriptionRecord {
  return {
    userId: r.user_id,
    status: r.status as SubscriptionStatus,
    trialEndsAt: r.trial_ends_at.getTime(),
    trialExtended: r.trial_extended,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    currentPeriodEnd: r.current_period_end ? r.current_period_end.getTime() : null,
  };
}

export class PgSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, trialEndsAt: number): Promise<SubscriptionRecord> {
    const { rows } = await this.pool.query<SubRow>(
      `INSERT INTO subscriptions (user_id, status, trial_ends_at)
       VALUES ($1, 'trialing', to_timestamp($2 / 1000.0))
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING ${SUB_COLS}`,
      [userId, trialEndsAt],
    );
    return toSub(rows[0]!);
  }

  async get(userId: string): Promise<SubscriptionRecord | null> {
    const { rows } = await this.pool.query<SubRow>(`SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = $1`, [userId]);
    return rows[0] ? toSub(rows[0]) : null;
  }

  async update(userId: string, patch: SubscriptionPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (frag: string, val: unknown) => { params.push(val); sets.push(frag.replace('$?', `$${params.length}`)); };
    if (patch.status !== undefined) push('status = $?', patch.status);
    if (patch.stripeCustomerId !== undefined) push('stripe_customer_id = $?', patch.stripeCustomerId);
    if (patch.stripeSubscriptionId !== undefined) push('stripe_subscription_id = $?', patch.stripeSubscriptionId);
    if (patch.trialEndsAt !== undefined) push('trial_ends_at = to_timestamp($? / 1000.0)', patch.trialEndsAt);
    if (patch.trialExtended !== undefined) push('trial_extended = $?', patch.trialExtended);
    if (patch.currentPeriodEnd !== undefined) {
      if (patch.currentPeriodEnd === null) push('current_period_end = $?', null);
      else push('current_period_end = to_timestamp($? / 1000.0)', patch.currentPeriodEnd);
    }
    if (sets.length === 0) return;
    params.push(userId);
    await this.pool.query(`UPDATE subscriptions SET ${sets.join(', ')} WHERE user_id = $${params.length}`, params);
  }

  async listTrialing(): Promise<Array<{ userId: string; trialEndsAt: number }>> {
    const { rows } = await this.pool.query<{ user_id: string; trial_ends_at: Date }>(
      `SELECT user_id, trial_ends_at FROM subscriptions WHERE status = 'trialing'`,
    );
    return rows.map((r) => ({ userId: r.user_id, trialEndsAt: r.trial_ends_at.getTime() }));
  }

  async findByCustomerId(customerId: string): Promise<SubscriptionRecord | null> {
    const { rows } = await this.pool.query<SubRow>(`SELECT ${SUB_COLS} FROM subscriptions WHERE stripe_customer_id = $1`, [customerId]);
    return rows[0] ? toSub(rows[0]) : null;
  }
}

export class PgTrialGrantRepository implements TrialGrantRepository {
  constructor(private readonly pool: Pool) {}
  async grantOrGet(email: string, nowMs: number): Promise<number> {
    const { rows } = await this.pool.query<{ granted_at: Date }>(
      `INSERT INTO trial_grants (email, granted_at) VALUES ($1, to_timestamp($2 / 1000.0))
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING granted_at`,
      [email, nowMs],
    );
    return rows[0]!.granted_at.getTime();
  }
}

export class PgWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly pool: Pool) {}
  async seen(eventId: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM webhook_events WHERE id = $1', [eventId]);
    return rows.length > 0;
  }
  async record(eventId: string): Promise<void> {
    await this.pool.query('INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [eventId]);
  }
}
