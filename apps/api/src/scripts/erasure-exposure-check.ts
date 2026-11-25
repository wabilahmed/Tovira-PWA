/**
 * [P88-1 · owner, 25 Nov] READ-ONLY: was any erasure restriction ever open in prod (P87-3 found surfaces that could show a
 * restricted person's words, but only while a request is open), and which accounts exist now.
 * - erasure_requests: every request still stored, by status (it cascades with its account, so a deleted account's
 *   requests are gone; that is why the next two are counted too).
 * - erasure_receipts: one per COMPLETED erasure, kept beyond account deletion (no user id, nothing cascades into it).
 * - erasure_audit: the per-account record that an erasure ran.
 * - the accounts, each email redacted the way every ops script redacts it, with the day it was created.
 * One READ ONLY transaction, rolled back. Refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/erasure-exposure-check.ts
 *   In prod: scripts/ops/run-backfill.sh --script erasure-exposure-check
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { redactEmail } from './stripe-mode-audit.js';

export const EXPOSURE_COUNTS_SQL = `
SELECT (SELECT count(*) FROM erasure_requests) AS requests,
       (SELECT count(*) FROM erasure_receipts) AS receipts,
       (SELECT count(*) FROM erasure_audit) AS audits`;
export const EXPOSURE_STATUS_SQL = `SELECT status, count(*) AS n FROM erasure_requests GROUP BY status ORDER BY status`;
export const EXPOSURE_ACCOUNTS_SQL = `SELECT email, created_at FROM users ORDER BY created_at`;

export interface ExposureResult {
  requests: number; receipts: number; audits: number;
  byStatus: Array<{ status: string; n: number }>;
  accounts: Array<{ email: string; createdOn: string }>;
}
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parseExposureArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('erasure-exposure-check is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (erasure-exposure-check takes none; it is read-only)`);
  }
  return {};
}

export async function runExposureCheck(db: Queryable): Promise<ExposureResult> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    const c = (await db.query(EXPOSURE_COUNTS_SQL)).rows[0] ?? {};
    const byStatus = (await db.query(EXPOSURE_STATUS_SQL)).rows.map((r) => ({ status: String(r.status), n: Number(r.n) }));
    const accounts = (await db.query(EXPOSURE_ACCOUNTS_SQL)).rows.map((r) => ({
      email: redactEmail(String(r.email ?? '')),
      createdOn: new Date(r.created_at as string | Date).toISOString().slice(0, 10),
    }));
    return { requests: Number(c.requests ?? 0), receipts: Number(c.receipts ?? 0), audits: Number(c.audits ?? 0), byStatus, accounts };
  } finally {
    await db.query('ROLLBACK');
  }
}

export function formatExposure(r: ExposureResult): string[] {
  return [
    `erasure requests stored (all statuses): ${r.requests}${r.byStatus.length ? ` (${r.byStatus.map((s) => `${s.status} ${s.n}`).join(', ')})` : ''}`,
    `completed erasures on record (kept beyond account deletion): ${r.receipts}`,
    `erasure audit rows: ${r.audits}`,
    `accounts: ${r.accounts.length}`,
    ...r.accounts.map((a) => `  ${a.email} (created ${a.createdOn})`),
  ];
}

async function main(): Promise<void> {
  parseExposureArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      for (const line of formatExposure(await runExposureCheck(client))) console.log(`[erasure-exposure] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[erasure-exposure] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
