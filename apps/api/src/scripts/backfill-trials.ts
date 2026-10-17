/**
 * [P14-0 / P15] One-off, idempotent backfill: start a 14-day trial (from NOW) for accounts that became
 * usable BEFORE P14-0 wired the trial into invite-accept, so they have no subscription row.
 *
 * ELIGIBILITY — a user is backfilled only if ALL hold:
 *   1. USABLE (accepted) — `users.terms_accepted_at IS NOT NULL`. This is the column that actually proves
 *      usability: invite-accept writes it (setPasswordAndTermsWithClient) and so does signup, but the
 *      approval INSERT (createInvitedWithClient) does NOT — and approval also sets an UNUSABLE random
 *      password, so `password_hash` is non-null for an approved-but-not-accepted invite and can't
 *      distinguish it. An approved-but-not-accepted account (terms_accepted_at NULL) is EXCLUDED — its
 *      trial must start when IT accepts, not now (that is exactly what P14-0 fixed).
 *   2. NO subscription row — a trial IS a subscriptions row (status 'trialing'), so "no row" is precisely
 *      "no trial and no subscription". ON CONFLICT (user_id) DO NOTHING makes a repeat run a no-op.
 *   3. NOT an ops/test/seed account. The schema has NO role/is_test/flag column (checked every migration),
 *      so these are an EXPLICIT list (ids and/or emails), never an email-pattern guess. Defaults below;
 *      extend via BACKFILL_EXCLUDE_IDS / BACKFILL_EXCLUDE_EMAILS (comma-separated). `--only <id>` bypasses
 *      this list for one named account (but NEVER the accept rule or idempotency — it will not trial a
 *      pending account or re-trial a subscribed one).
 *
 * The AED 60 monthly allowance is IMPLICIT — `onSignup` creates no allowance row; the month materializes
 * lazily (ensureMonth, default DEFAULT_MONTHLY_AI_ALLOWANCE_AED) against the window the trialing
 * subscription defines. So inserting the trialing subscription confers both the 14-day trial AND the AED
 * 60 allowance; there is nothing else to write. The apply runs in ONE transaction (all-or-nothing).
 *
 * DRY-RUN BY DEFAULT — prints every candidate (id, email, created_at, accepted_at, reason) + a separate
 * excluded section with each exclusion reason, and writes nothing. Pass --apply to write.
 *   Dry run:   DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-trials.ts
 *   Apply:     DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-trials.ts --apply
 *   One acct:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-trials.ts --only <userId> [--apply]
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { DEFAULT_TRIAL_DAYS } from '../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** [P15] Ops/test/seed accounts skipped by DEFAULT (no is_test/role column exists — explicit, reviewed,
 *  never an email guess). Extend via BACKFILL_EXCLUDE_IDS / BACKFILL_EXCLUDE_EMAILS. `--only` bypasses it. */
export const DEFAULT_EXCLUDE_USER_IDS: readonly string[] = [
  '8747fb0a-d7c5-48e0-9732-cf524c47b5bb', // prod test rep (wabil+rep@prospera-technologies.com)
];
export const DEFAULT_EXCLUDE_EMAILS: readonly string[] = [];

/** [P15] Read-only eligibility query (the universe to reason about: accepted-or-not, with/without a
 *  subscription). The in-script ops/test exclusion is applied AFTER, in planBackfill — so this stays a
 *  faithful, runnable SQL the operator can inspect first. */
const ELIGIBILITY_SQL_BASE = `
SELECT u.id,
       u.email,
       u.created_at,
       u.terms_accepted_at AS accepted_at,
       (s.user_id IS NOT NULL) AS has_subscription
  FROM users u
  LEFT JOIN subscriptions s ON s.user_id = u.id`;
export const ELIGIBILITY_SQL = `${ELIGIBILITY_SQL_BASE}\n ORDER BY u.created_at`;

export interface AccountState {
  id: string;
  email: string;
  createdAt: string;
  /** users.terms_accepted_at — null iff approved-but-not-accepted (a pending invite). */
  acceptedAt: string | null;
  hasSubscription: boolean;
}

export type ExcludeReason =
  | 'pending invite (not accepted)'
  | 'ops/test/seed account'
  | 'already has a subscription'
  | 'not named by --only';

export interface Plan {
  included: Array<{ account: AccountState; reason: string }>;
  excluded: Array<{ account: AccountState; reason: ExcludeReason }>;
}

export interface PlanOptions {
  excludeUserIds: Set<string>;
  excludeEmails: Set<string>; // lowercased
  onlyUserId?: string | null;
}

/**
 * [P15] PURE eligibility decision (unit-tested). Order matters: idempotency (already subscribed) and the
 * accept rule are enforced for EVERYONE, including a `--only` target — `--only` only bypasses the
 * ops/test/seed exclusion, never the rule that we don't trial a pending account or re-trial a paid one.
 */
export function planBackfill(accounts: AccountState[], opts: PlanOptions): Plan {
  const plan: Plan = { included: [], excluded: [] };
  const only = opts.onlyUserId ?? null;
  for (const account of accounts) {
    if (only && account.id !== only) {
      plan.excluded.push({ account, reason: 'not named by --only' });
      continue;
    }
    if (account.hasSubscription) {
      plan.excluded.push({ account, reason: 'already has a subscription' });
      continue;
    }
    if (!account.acceptedAt) {
      plan.excluded.push({ account, reason: 'pending invite (not accepted)' });
      continue;
    }
    if (only === account.id) {
      plan.included.push({ account, reason: 'named by --only (ops/test exclusion bypassed)' });
      continue;
    }
    if (opts.excludeUserIds.has(account.id) || opts.excludeEmails.has(account.email.toLowerCase())) {
      plan.excluded.push({ account, reason: 'ops/test/seed account' });
      continue;
    }
    plan.included.push({ account, reason: 'accepted, no subscription' });
  }
  return plan;
}

function envList(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const onlyIdx = process.argv.indexOf('--only');
  const onlyUserId = onlyIdx >= 0 ? process.argv[onlyIdx + 1] ?? null : null;
  if (onlyIdx >= 0 && !onlyUserId) { console.error('--only requires a userId'); process.exit(1); }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }

  const excludeUserIds = new Set<string>([...DEFAULT_EXCLUDE_USER_IDS, ...envList('BACKFILL_EXCLUDE_IDS')]);
  const excludeEmails = new Set<string>([...DEFAULT_EXCLUDE_EMAILS, ...envList('BACKFILL_EXCLUDE_EMAILS')].map((e) => e.toLowerCase()));

  // [P17-SSL] Use the SAME pool factory the API uses — it enables TLS for RDS (local stays plain), so a
  // script never fails with "no pg_hba.conf entry … no encryption" the way a raw new pg.Pool did.
  const pool = createPool(url);
  try {
    // With --only, fetch JUST that account so the dry run shows only it (no "not named by --only" noise).
    const { rows } = await pool.query<{ id: string; email: string; created_at: Date; accepted_at: Date | null; has_subscription: boolean }>(
      onlyUserId ? `${ELIGIBILITY_SQL_BASE} WHERE u.id = $1` : ELIGIBILITY_SQL,
      onlyUserId ? [onlyUserId] : [],
    );
    const accounts: AccountState[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      createdAt: r.created_at.toISOString(),
      acceptedAt: r.accepted_at ? r.accepted_at.toISOString() : null,
      hasSubscription: r.has_subscription,
    }));
    const plan = planBackfill(accounts, { excludeUserIds, excludeEmails, onlyUserId });
    const trialEndsAt = Date.now() + DEFAULT_TRIAL_DAYS * DAY_MS;

    console.log(`[backfill-trials] ${onlyUserId ? `--only ${onlyUserId}` : 'full scan'} · trial = ${DEFAULT_TRIAL_DAYS}d from now, ends ${new Date(trialEndsAt).toISOString()} (AED 60 allowance is implicit — no row to write).`);
    console.log(`[backfill-trials] INCLUDED (${plan.included.length}) — would get a trial:`);
    for (const { account: a, reason } of plan.included) {
      console.log(`  + ${a.id}  ${a.email}  created=${a.createdAt}  accepted=${a.acceptedAt ?? 'NULL'}  — ${reason}`);
    }
    // Only show excluded accounts that are genuinely in scope (no subscription, or the --only target) so
    // the section stays meaningful — not every subscribed rep in the table.
    const excludedToShow = plan.excluded.filter((e) => !e.account.hasSubscription || (e.reason === 'already has a subscription' && onlyUserId === e.account.id));
    console.log(`[backfill-trials] EXCLUDED (${excludedToShow.length} shown of ${plan.excluded.length}):`);
    for (const { account: a, reason } of excludedToShow) {
      console.log(`  - ${a.id}  ${a.email}  created=${a.createdAt}  accepted=${a.acceptedAt ?? 'NULL'}  — ${reason}`);
    }

    if (!apply) {
      console.log('[backfill-trials] DRY RUN — no writes. Re-run with --apply to insert trialing subscriptions.');
      return;
    }

    // One transaction, all-or-nothing. Each insert is idempotent (ON CONFLICT DO NOTHING).
    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const { account } of plan.included) {
        const r = await client.query(
          `INSERT INTO subscriptions (user_id, status, trial_ends_at)
           VALUES ($1, 'trialing', to_timestamp($2 / 1000.0))
           ON CONFLICT (user_id) DO NOTHING`,
          [account.id, trialEndsAt],
        );
        inserted += (r as { rowCount: number }).rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`[backfill-trials] inserted ${inserted} trialing subscription(s) (of ${plan.included.length} candidate(s)).`);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[backfill-trials] failed', e); process.exit(1); });
}
