/**
 * [P14-0] One-off, idempotent backfill: start a 14-day trial (from NOW) for accounts that have no
 * subscription row — the invited reps who never got one because invite-accept didn't start a trial.
 *
 * Safe to re-run: it only inserts for users with NO subscription row, and INSERT … ON CONFLICT DO
 * NOTHING makes a concurrent/repeat run a no-op. It never touches an account that already has a
 * subscription (trialing, active, ended, whatever) — those are the source of truth.
 *
 * DRY-RUN BY DEFAULT — prints what it WOULD do and writes nothing. Pass --apply to write.
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-trials.ts
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-trials.ts --apply
 */
import pg from 'pg';
import { DEFAULT_TRIAL_DAYS } from '../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows: missing } = await pool.query<{ id: string }>(
      `SELECT u.id FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE s.user_id IS NULL`,
    );
    const trialEndsAt = Date.now() + DEFAULT_TRIAL_DAYS * DAY_MS;
    console.log(`[backfill-trials] ${missing.length} account(s) with no subscription row; trial would end ${new Date(trialEndsAt).toISOString()} (${DEFAULT_TRIAL_DAYS}d from now).`);
    if (!apply) {
      console.log('[backfill-trials] DRY RUN — no writes. Re-run with --apply to insert trialing subscriptions.');
      return;
    }
    let inserted = 0;
    for (const { id } of missing) {
      const r = await pool.query(
        `INSERT INTO subscriptions (user_id, status, trial_ends_at)
         VALUES ($1, 'trialing', to_timestamp($2 / 1000.0))
         ON CONFLICT (user_id) DO NOTHING`,
        [id, trialEndsAt],
      );
      inserted += (r as { rowCount: number }).rowCount ?? 0;
    }
    console.log(`[backfill-trials] inserted ${inserted} trialing subscription(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('[backfill-trials] failed', e); process.exit(1); });
