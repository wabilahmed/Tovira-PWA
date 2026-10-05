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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  current_period_start: Date | null;
  billing_name: string | null;
  billing_company: string | null;
  billing_state: string;
  first_failed_at: Date | null;
  last_retry_at: Date | null;
  open_invoice_id: string | null;
  hosted_invoice_url: string | null;
  hard_decline_count: number;
  auth_required_count: number;
  deletion_warned_30d: boolean;
  deletion_warned_7d: boolean;
  ended_at: Date | null;
}
// [TRIAL-14] trial_extended is intentionally NOT selected/written — the usage-gated extension is gone
// (flat 14-day trial). The column is left in the DB (orphaned, reported), so this list simply omits it.
const SUB_COLS = 'user_id, status, trial_ends_at, stripe_customer_id, stripe_subscription_id, current_period_end, current_period_start, billing_name, billing_company, billing_state, first_failed_at, last_retry_at, open_invoice_id, hosted_invoice_url, hard_decline_count, auth_required_count, deletion_warned_30d, deletion_warned_7d, ended_at';
const ms = (d: Date | null): number | null => (d ? d.getTime() : null);
function toSub(r: SubRow): SubscriptionRecord {
  return {
    userId: r.user_id,
    status: r.status as SubscriptionStatus,
    trialEndsAt: r.trial_ends_at.getTime(),
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    currentPeriodEnd: ms(r.current_period_end),
    currentPeriodStart: ms(r.current_period_start),
    billingName: r.billing_name,
    billingCompany: r.billing_company,
    billingState: r.billing_state as SubscriptionRecord['billingState'],
    firstFailedAt: ms(r.first_failed_at),
    lastRetryAt: ms(r.last_retry_at),
    openInvoiceId: r.open_invoice_id,
    hostedInvoiceUrl: r.hosted_invoice_url,
    hardDeclineCount: Number(r.hard_decline_count),
    authRequiredCount: Number(r.auth_required_count),
    deletionWarned30d: r.deletion_warned_30d,
    deletionWarned7d: r.deletion_warned_7d,
    endedAt: ms(r.ended_at),
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
    if (patch.currentPeriodEnd !== undefined) {
      if (patch.currentPeriodEnd === null) push('current_period_end = $?', null);
      else push('current_period_end = to_timestamp($? / 1000.0)', patch.currentPeriodEnd);
    }
    if (patch.currentPeriodStart !== undefined) {
      if (patch.currentPeriodStart === null) push('current_period_start = $?', null);
      else push('current_period_start = to_timestamp($? / 1000.0)', patch.currentPeriodStart);
    }
    if (patch.billingName !== undefined) push('billing_name = $?', patch.billingName);
    if (patch.billingCompany !== undefined) push('billing_company = $?', patch.billingCompany);
    if (patch.billingState !== undefined) push('billing_state = $?', patch.billingState);
    if (patch.firstFailedAt !== undefined) push(patch.firstFailedAt === null ? 'first_failed_at = $?' : 'first_failed_at = to_timestamp($? / 1000.0)', patch.firstFailedAt);
    if (patch.lastRetryAt !== undefined) push(patch.lastRetryAt === null ? 'last_retry_at = $?' : 'last_retry_at = to_timestamp($? / 1000.0)', patch.lastRetryAt);
    if (patch.openInvoiceId !== undefined) push('open_invoice_id = $?', patch.openInvoiceId);
    if (patch.hostedInvoiceUrl !== undefined) push('hosted_invoice_url = $?', patch.hostedInvoiceUrl);
    if (patch.hardDeclineCount !== undefined) push('hard_decline_count = $?', patch.hardDeclineCount);
    if (patch.authRequiredCount !== undefined) push('auth_required_count = $?', patch.authRequiredCount);
    if (patch.deletionWarned30d !== undefined) push('deletion_warned_30d = $?', patch.deletionWarned30d);
    if (patch.deletionWarned7d !== undefined) push('deletion_warned_7d = $?', patch.deletionWarned7d);
    if (patch.endedAt !== undefined) push(patch.endedAt === null ? 'ended_at = $?' : 'ended_at = to_timestamp($? / 1000.0)', patch.endedAt);
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

  async listInDunning(): Promise<SubscriptionRecord[]> {
    const { rows } = await this.pool.query<SubRow>(`SELECT ${SUB_COLS} FROM subscriptions WHERE billing_state IN ('payment_failed', 'suspended')`);
    return rows.map(toSub);
  }

  async listEnded(): Promise<SubscriptionRecord[]> {
    const { rows } = await this.pool.query<SubRow>(`SELECT ${SUB_COLS} FROM subscriptions WHERE billing_state = 'ended'`);
    return rows.map(toSub);
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
