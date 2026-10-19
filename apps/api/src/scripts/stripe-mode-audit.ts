/**
 * [P30-3] READ-ONLY audit before Stripe goes live: which accounts look paid but have nothing live behind them.
 * An account that subscribed while the app ran on Stripe TEST mode is 'active' in our database, and a live key
 * will never renew, charge or cancel it — so it would keep full access for free. This lists:
 *   - active accounts whose Stripe customer or subscription is from TEST mode (or no longer exists);
 *   - active accounts with no Stripe customer or subscription at all.
 * A test-mode id is recognised from Stripe's own answer under the live key ("No such customer …; a similar
 * object exists in test mode"). Customer ids look the same in both modes, so the database alone can't tell.
 *
 * Read-only: one READ ONLY transaction (rolled back); Stripe retrieve (GET) calls only; prints user id, a
 * redacted email (first 3 characters + domain), status, created date and the verdicts — never the key.
 * Takes no arguments and refuses --apply. It changes no rows.
 *   Local:   DATABASE_URL=… STRIPE_SECRET_KEY=… npx tsx apps/api/src/scripts/stripe-mode-audit.ts
 *   In prod: scripts/ops/run-backfill.sh --script stripe-mode-audit
 */
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { createPool } from '../db/pool.js';

/** Every account that looks paid, or that ever got a Stripe id (oldest first). */
export const STRIPE_MODE_CANDIDATES_SQL = `
SELECT s.user_id, u.email, s.status, s.billing_state, u.created_at, s.stripe_customer_id, s.stripe_subscription_id
  FROM subscriptions s
  JOIN users u ON u.id = s.user_id
 WHERE s.status = 'active' OR s.stripe_customer_id IS NOT NULL OR s.stripe_subscription_id IS NOT NULL
 ORDER BY u.created_at`;

export type IdVerdict = 'live' | 'test' | 'missing' | 'error' | 'none';
type Retrieve = (id: string) => Promise<{ id: string; livemode?: boolean }>;
export interface AuditStripe { customers: { retrieve: Retrieve }; subscriptions: { retrieve: Retrieve } }
interface Queryable { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }

export interface FlaggedAccount {
  userId: string; email: string; status: string; billingState: string; createdAt: string;
  customer: IdVerdict; subscription: IdVerdict; reason: string;
}
export interface AuditResult { checked: number; flagged: FlaggedAccount[] }

export function parseAuditArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('stripe-mode-audit is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (stripe-mode-audit takes none; it is read-only)`);
  }
  return {};
}

/** "wabil@prospera-technologies.com" → "wab…@prospera-technologies.com". */
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return `${email.slice(0, 3)}…`;
  return `${email.slice(0, Math.min(3, at))}…${email.slice(at)}`;
}

/** The key's mode from its prefix ("live" / "test"), without ever printing the key. */
export function keyMode(key: string | undefined): 'live' | 'test' | 'unknown' | 'none' {
  if (!key) return 'none';
  const m = /^[rs]k_(live|test)_/.exec(key.trim());
  return m ? (m[1] as 'live' | 'test') : 'unknown';
}

/** live = Stripe has it in this key's mode; test = Stripe says it exists only in test mode; missing = gone. */
export async function classifyStripeId(retrieve: Retrieve, id: string | null): Promise<IdVerdict> {
  if (!id) return 'none';
  try {
    const obj = await retrieve(id);
    return obj.livemode === false ? 'test' : 'live';
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    if (e?.code !== 'resource_missing') return 'error';
    return typeof e.message === 'string' && /exists in test mode/i.test(e.message) ? 'test' : 'missing';
  }
}

export async function runStripeModeAudit(db: Queryable, stripe: AuditStripe): Promise<AuditResult> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await db.query(STRIPE_MODE_CANDIDATES_SQL)).rows;
  } finally {
    await db.query('ROLLBACK');
  }
  const flagged: FlaggedAccount[] = [];
  for (const r of rows) {
    const customer = await classifyStripeId((id) => stripe.customers.retrieve(id), (r.stripe_customer_id as string | null) ?? null);
    const subscription = await classifyStripeId((id) => stripe.subscriptions.retrieve(id), (r.stripe_subscription_id as string | null) ?? null);
    if (r.status !== 'active') continue; // only accounts that currently get paid access
    const stale = [customer, subscription].some((v) => v === 'test' || v === 'missing');
    const reason = customer === 'none' && subscription === 'none'
      ? 'active with no Stripe customer or subscription'
      : stale ? 'active with a test-mode Stripe customer/subscription' : null;
    if (!reason) continue;
    const created = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? '');
    flagged.push({
      userId: String(r.user_id), email: redactEmail(String(r.email ?? '')), status: String(r.status), billingState: String(r.billing_state ?? ''),
      createdAt: created.slice(0, 10), customer, subscription, reason,
    });
  }
  return { checked: rows.length, flagged };
}

export function formatAudit(r: AuditResult & { keyMode: string }): string[] {
  const out = [`Stripe key mode: ${r.keyMode}`];
  if (r.keyMode !== 'live') out.push('WARNING: the Stripe key in this task is a TEST key — test-mode ids look valid under it, so nothing can be flagged as test. Run after the live key is in tovira/prod/app.');
  out.push(`checked ${r.checked} account(s) (active, or with any Stripe id)`);
  for (const f of r.flagged) out.push(`FLAG ${f.userId}  ${f.email}  status=${f.status}  created=${f.createdAt}  customer=${f.customer}  subscription=${f.subscription}  — ${f.reason}`);
  out.push(`${r.flagged.length} account(s) flagged. Nothing was changed.`);
  return out;
}

async function main(): Promise<void> {
  parseAuditArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!url || !key) { console.error('DATABASE_URL and STRIPE_SECRET_KEY are required.'); process.exit(1); }
  const stripe = new Stripe(key) as unknown as AuditStripe;
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      const result = await runStripeModeAudit(client, stripe);
      for (const line of formatAudit({ ...result, keyMode: keyMode(key) })) console.log(`[stripe-mode-audit] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[stripe-mode-audit] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
