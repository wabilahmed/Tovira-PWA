/**
 * [P61 · owner] READ-ONLY: accounts whose stored trial end is not what the emails promise (14 days). Report only; it
 * changes nothing. Two kinds:
 *   - short_trial: the trial is under 14 days from its grant (granted in the 7-day era, before TRIAL-14);
 *   - ended_before_account: the account was created after its inbox's trial had already ended (one trial per inbox,
 *     plus-tags and Gmail dots folded), so it started with no trial; its welcome showed the old end date (fixed in P61-2).
 * One READ ONLY transaction (rolled back); prints user id, a redacted email, created date, trial end, grant date, the
 * trial length in days and the verdict. Takes no arguments and refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/trial-end-audit.ts
 *   In prod: scripts/ops/run-backfill.sh --script trial-end-audit
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { normalizeTrialEmailKey } from '../services/billing/trial-email-key.js';
import { redactEmail } from './stripe-mode-audit.js';

const DAY = 86_400_000;
export const TRIAL_DAYS_PROMISED = 14;

export const TRIAL_ACCOUNTS_SQL = `
SELECT s.user_id, u.email, s.status, u.created_at, s.trial_ends_at
  FROM subscriptions s
  JOIN users u ON u.id = s.user_id
 WHERE s.status = 'trialing'
 ORDER BY u.created_at`;
export const TRIAL_GRANTS_SQL = 'SELECT email, granted_at FROM trial_grants';

interface Queryable { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }
export type TrialVerdict = 'short_trial' | 'ended_before_account';
export interface TrialFinding { userId: string; email: string; createdAt: string; trialEndsAt: string; grantedAt: string | null; days: number | null; verdict: TrialVerdict }

const iso = (v: unknown): string => new Date(v as string | Date).toISOString().slice(0, 10);
const ms = (v: unknown): number => new Date(v as string | Date).getTime();

export function parseTrialAuditArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('trial-end-audit is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (trial-end-audit takes none; it is read-only)`);
  }
  return {};
}

export async function runTrialEndAudit(db: Queryable): Promise<{ checked: number; findings: TrialFinding[] }> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  let accounts: Array<Record<string, unknown>>;
  let grants: Array<Record<string, unknown>>;
  try {
    accounts = (await db.query(TRIAL_ACCOUNTS_SQL)).rows;
    grants = (await db.query(TRIAL_GRANTS_SQL)).rows;
  } finally {
    await db.query('ROLLBACK');
  }
  const grantOf = new Map(grants.map((g) => [String(g.email), ms(g.granted_at)]));
  const findings: TrialFinding[] = [];
  for (const a of accounts) {
    const email = String(a.email);
    const granted = grantOf.get(normalizeTrialEmailKey(email)) ?? null;
    const end = ms(a.trial_ends_at);
    const days = granted === null ? null : Math.round((end - granted) / DAY);
    const base = { userId: String(a.user_id), email: redactEmail(email), createdAt: iso(a.created_at), trialEndsAt: iso(a.trial_ends_at), grantedAt: granted === null ? null : iso(granted), days };
    if (end <= ms(a.created_at)) findings.push({ ...base, verdict: 'ended_before_account' });
    else if (days !== null && days < TRIAL_DAYS_PROMISED) findings.push({ ...base, verdict: 'short_trial' });
  }
  return { checked: accounts.length, findings };
}

async function main(): Promise<void> {
  parseTrialAuditArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  try {
    const { checked, findings } = await runTrialEndAudit(pool);
    console.log(`[trial-end-audit] READ-ONLY. Checked ${checked} trialing account(s); ${findings.length} not on a 14-day trial.`);
    for (const f of findings) console.log(`[trial-end-audit] ${f.verdict}  user ${f.userId}  ${f.email}  created ${f.createdAt}  trial ends ${f.trialEndsAt}  granted ${f.grantedAt ?? '?'}  (${f.days ?? '?'} days)`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => { console.error(`[trial-end-audit] ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
}
