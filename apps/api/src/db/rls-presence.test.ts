import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * [BETA-9 · RLS-PRESENCE] The DPIA tells counsel that tenant isolation is enforced at the DATABASE, not
 * in application code. Nothing guarded that claim: a new table added with no policy would silently
 * falsify it (the GRANT lint only checks grants). This lint makes it a decision on the record — every
 * CREATEd table must EITHER have tenant RLS (ENABLE + FORCE + a tenant_isolation policy) OR be listed in
 * RLS_EXEMPT with a one-line reason. "Nobody noticed" becomes "someone decided and wrote down why."
 */
const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));
const SQL = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');

const createdTables = (): string[] => [...SQL.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
const hasPolicy = (t: string): boolean => new RegExp(`CREATE POLICY [a-z_]+ ON ${t}\\b`, 'i').test(SQL);
const hasEnable = (t: string): boolean => new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, 'i').test(SQL);
const hasForce = (t: string): boolean => new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`, 'i').test(SQL);

/**
 * Tables with NO tenant RLS, each with the reason it is safe. Keep this SMALL and justified — every
 * entry is a table that genuinely cannot be tenant-scoped (pre-tenant auth, ops/owner plane, system/
 * billing writers with no session, or a global aggregate with no tenant column).
 */
const RLS_EXEMPT: Record<string, string> = {
  // Pre-tenant: accessed before any app.user_id exists.
  users: 'auth looks a user up by email before any tenant context exists; RLS keyed on app.user_id is impossible on it',
  sessions: 'session-token lookup happens before a tenant context is established',
  password_resets: 'consumed by an unauthenticated visitor clicking an emailed link; keyed by token hash, not a tenant',
  email_verifications: 'consumed by an unauthenticated visitor clicking an emailed link; keyed by token hash',
  access_requests: 'written by the PUBLIC beta request form before any user/tenant exists (BETA-3)',
  invites: 'consumed by an unauthenticated visitor clicking an emailed link; keyed by token hash (BETA-5/6)',
  // Ops / owner plane (also in the GRANT-LINT OWNER_PLANE where built on the migration pool).
  ops_alerts: 'ops/admin plane; built on the owner pool, read cross-tenant by the operator',
  spend_overrides: 'ops/admin plane; built on the owner pool, written by the OPS_TOKEN cap-override route',
  model_call_events: 'spend instrumentation; user_id is nullable (NULL = system call), written system-side on every model call and read cross-tenant by ops cost reports — never a rep query path',
  // System / billing writers that carry NO tenant session.
  email_log: 'lifecycle-email idempotency log; written system-side by the mailer (no tenant context on sends)',
  referrals: 'spans TWO users (referrer + referred), keyed by referred_email; written at signup/approval — not single-tenant',
  subscriptions: 'billing state; written by Stripe webhooks that carry no tenant session; read by userId server-side',
  trial_grants: 'trial grants keyed by email; written at signup + by billing jobs without a tenant session',
  webhook_events: 'Stripe webhook idempotency log; written by the webhook endpoint (no tenant session)',
  invoice_tax: 'VAT snapshot per invoice; written by the Stripe billing webhook (no tenant session)',
  scheduled_job_runs: 'scheduler run bookkeeping (advisory lock); written by the ScheduledBrain (system, no tenant)',
  push_budget: 'push send-budget; written by the scheduled push dispatcher (system, no tenant session)',
  erasure_receipts: 'post-erasure receipt (ERASURE §10); deliberately carries no user_id — the subject may be erased — so it cannot be tenant-scoped; operator-written',
  sensitive_flag_restores: 'global aggregate (SCREEN-REVIEW); has no user/note/client column by design, so there is nothing to tenant-scope',
  ai_global_month: 'USAGE-ALLOWANCE global spend record, one row per calendar month across ALL accounts (no user_id); for the email alert only, written+read on the superuser pool — nothing to tenant-scope',
};

describe('[BETA-9] every table is tenant-RLS enforced at the DB, or explicitly exempt with a reason', () => {
  it('no CREATEd table lacks tenant RLS without being in RLS_EXEMPT', () => {
    const offenders = [...new Set(createdTables())]
      .filter((t) => !(t in RLS_EXEMPT))
      .filter((t) => !(hasEnable(t) && hasForce(t) && hasPolicy(t)));
    expect(
      offenders,
      `these tables have no tenant RLS and are not in RLS_EXEMPT — add the policy (ENABLE+FORCE+tenant_isolation), or list them as RLS_EXEMPT with a reason: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every tenant-RLS table has ENABLE + FORCE + a policy (not just one of them)', () => {
    const partial = [...new Set(createdTables())]
      .filter((t) => !(t in RLS_EXEMPT))
      .filter((t) => hasPolicy(t) || hasEnable(t) || hasForce(t)) // claims to be RLS'd…
      .filter((t) => !(hasEnable(t) && hasForce(t) && hasPolicy(t))); // …but is missing a piece
    expect(partial, `tables with PARTIAL RLS (missing ENABLE, FORCE, or the policy): ${partial.join(', ')}`).toEqual([]);
  });

  it('RLS_EXEMPT is honest and small: each entry is a real table with NO policy and a real reason', () => {
    const created = new Set(createdTables());
    for (const [t, reason] of Object.entries(RLS_EXEMPT)) {
      expect(created.has(t), `RLS_EXEMPT lists "${t}" but no migration creates it (stale entry)`).toBe(true);
      expect(hasPolicy(t), `RLS_EXEMPT lists "${t}" but it HAS a tenant policy — remove it from the allowlist`).toBe(false);
      expect(reason.trim().length, `RLS_EXEMPT "${t}" needs a real one-line reason`).toBeGreaterThan(20);
    }
  });
});
