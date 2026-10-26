/**
 * [P44-3] READ-ONLY audit: every subscription whose stored billing period differs from Stripe's own (the subscription
 * item's current_period_start / _end). Before the P44-3 fix the webhook stored the invoice's look-back period, so a
 * renewed subscription may sit one period behind. Lists each difference; writes NOTHING (there is no --apply).
 *   Local:    DATABASE_URL=… STRIPE_SECRET_KEY=… npx tsx apps/api/src/scripts/audit-subscription-periods.ts
 *   In prod:  scripts/ops/run-backfill.sh --script subscription-periods        (read-only by design)
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { StripeGatewayImpl } from '../adapters/billing/stripe-gateway.js';

export interface StoredPeriod { userId: string; subscriptionId: string; status: string; start: number | null; end: number | null }
export interface PeriodDiff { userId: string; subscriptionId: string; status: string; stored: { start: number | null; end: number | null }; stripe: { start: number; end: number } | null; why: 'differs' | 'stripe_unreadable' }

/** PURE: compare what the app stores with what Stripe says. Equal → not listed. */
export function diffPeriods(rows: StoredPeriod[], stripe: Map<string, { start: number; end: number } | null>): PeriodDiff[] {
  const out: PeriodDiff[] = [];
  for (const r of rows) {
    const s = stripe.get(r.subscriptionId) ?? null;
    if (!s) { out.push({ userId: r.userId, subscriptionId: r.subscriptionId, status: r.status, stored: { start: r.start, end: r.end }, stripe: null, why: 'stripe_unreadable' }); continue; }
    if (s.start !== r.start || s.end !== r.end) out.push({ userId: r.userId, subscriptionId: r.subscriptionId, status: r.status, stored: { start: r.start, end: r.end }, stripe: s, why: 'differs' });
  }
  return out;
}

const iso = (ms: number | null | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 16) : '(none)');
export function formatDiff(d: PeriodDiff): string {
  if (d.why === 'stripe_unreadable') return `? ${d.userId}  ${d.subscriptionId}  (${d.status})  stored ${iso(d.stored.start)} → ${iso(d.stored.end)}  Stripe: could not read (wrong mode or deleted)`;
  return `≠ ${d.userId}  ${d.subscriptionId}  (${d.status})  stored ${iso(d.stored.start)} → ${iso(d.stored.end)}  Stripe ${iso(d.stripe!.start)} → ${iso(d.stripe!.end)}`;
}

/** Read-only: subscriptions that have a Stripe subscription id. */
export const SUBSCRIPTIONS_SQL = `SELECT user_id::text AS user_id, stripe_subscription_id, status, current_period_start, current_period_end
  FROM subscriptions WHERE stripe_subscription_id IS NOT NULL ORDER BY updated_at`;

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) { console.error('[subscription-periods] read-only: there is no --apply.'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!url || !key) { console.error('DATABASE_URL and STRIPE_SECRET_KEY are required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const { rows } = await pool.query<{ user_id: string; stripe_subscription_id: string; status: string; current_period_start: Date | null; current_period_end: Date | null }>(SUBSCRIPTIONS_SQL);
    const gateway = new StripeGatewayImpl({ secretKey: key, webhookSecret: '', priceId: '', successUrl: '', cancelUrl: '' } as never);
    const stripe = new Map<string, { start: number; end: number } | null>();
    for (const r of rows) stripe.set(r.stripe_subscription_id, await gateway.subscriptionPeriod(r.stripe_subscription_id)); // retrieve only
    const diffs = diffPeriods(rows.map((r) => ({ userId: r.user_id, subscriptionId: r.stripe_subscription_id, status: r.status, start: r.current_period_start?.getTime() ?? null, end: r.current_period_end?.getTime() ?? null })), stripe);
    console.log(`[subscription-periods] ${rows.length} subscription(s) with a Stripe id; ${diffs.length} differ from Stripe (READ-ONLY, nothing written):`);
    for (const d of diffs) console.log(`  ${formatDiff(d)}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[subscription-periods] failed', e); process.exit(1); });
}
