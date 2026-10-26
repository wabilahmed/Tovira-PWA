/**
 * [P46-2] READ-ONLY: how many reps have no stored push subscription (so no alerts or meeting nudges reach them).
 * The server cannot see a browser's notification permission; what it can count is reps with ZERO stored subscriptions.
 * Counts only (no endpoints, no ids), inside one READ ONLY transaction that is rolled back. Refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/push-audit.ts
 *   In prod: scripts/ops/run-backfill.sh --script push-audit
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';

export const PUSH_AUDIT_SQL = `
SELECT (SELECT count(*) FROM users) AS reps,
       (SELECT count(DISTINCT user_id) FROM push_subscriptions) AS with_subscription,
       (SELECT count(*) FROM push_subscriptions) AS subscriptions`;

export interface PushAuditResult { reps: number; withSubscription: number; withoutSubscription: number; subscriptions: number }
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parsePushAuditArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('push-audit is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (push-audit takes none; it is read-only)`);
  }
  return {};
}

export async function runPushAudit(db: Queryable): Promise<PushAuditResult> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    const r = (await db.query(PUSH_AUDIT_SQL)).rows[0] ?? {};
    const reps = Number(r.reps ?? 0);
    const withSubscription = Number(r.with_subscription ?? 0);
    return { reps, withSubscription, withoutSubscription: reps - withSubscription, subscriptions: Number(r.subscriptions ?? 0) };
  } finally {
    await db.query('ROLLBACK');
  }
}

export function formatPushAudit(r: PushAuditResult): string[] {
  return [
    `reps: ${r.reps}`,
    `reps with a stored push subscription: ${r.withSubscription} (${r.subscriptions} subscriptions in total)`,
    `reps with NO stored push subscription (no alerts or meeting nudges reach them): ${r.withoutSubscription}`,
  ];
}

async function main(): Promise<void> {
  parsePushAuditArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      for (const line of formatPushAudit(await runPushAudit(client))) console.log(`[push-audit] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[push-audit] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
