/**
 * [P53-5] READ-ONLY: how many stored notes and messages would match the new Indian Tier-1 rules (Aadhaar, PAN, Indian
 * passports, the wider bank-account labels) if they were redacted today. Stored data was redacted with the rules of its
 * day, so a match here is a value stored before P53. Counts only (no text, no ids), paged inside one READ ONLY
 * transaction that is rolled back. Nothing is changed. Refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/tier1-india-audit.ts
 *   In prod: scripts/ops/run-backfill.sh --script tier1-india-audit
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { redactMessages, redactSensitive } from '../services/redaction/redact.js';

export const TIER1_INDIA_AUDIT_SQL = `
SELECT id, raw_text, messages FROM notes WHERE id > $1 ORDER BY id LIMIT 500`;
const KINDS = ['aadhaar', 'pan', 'passport', 'bank_account'] as const;
type Kind = (typeof KINDS)[number];

export interface Tier1IndiaAuditResult { notesScanned: number; notesAffected: number; textsAffected: number; byKind: Record<Kind, number> }
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parseTier1IndiaAuditArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('tier1-india-audit is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (tier1-india-audit takes none; it is read-only)`);
  }
  return {};
}

export async function runTier1IndiaAudit(db: Queryable): Promise<Tier1IndiaAuditResult> {
  const r: Tier1IndiaAuditResult = { notesScanned: 0, notesAffected: 0, textsAffected: 0, byKind: { aadhaar: 0, pan: 0, passport: 0, bank_account: 0 } };
  const tally = (counts: Record<string, number>): boolean => {
    let hit = false;
    for (const k of KINDS) if ((counts[k] ?? 0) > 0) { r.byKind[k] += counts[k]!; hit = true; }
    return hit;
  };
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = (await db.query(TIER1_INDIA_AUDIT_SQL, [after])).rows;
      if (rows.length === 0) break;
      for (const row of rows) {
        r.notesScanned += 1;
        after = String(row.id);
        const messages = Array.isArray(row.messages) ? (row.messages as Array<{ sender?: string; body?: string }>) : [];
        let noteHit = false;
        if (messages.length > 0) {
          // message by message, as imports redact (a split Aadhaar is joined across messages)
          const red = redactMessages(messages.map((m) => ({ sender: m.sender ?? '', body: m.body ?? '' })));
          const per = messages.map((m) => redactSensitive(m.body ?? ''));
          for (const p of per) if (KINDS.some((k) => (p.counts[k] ?? 0) > 0)) r.textsAffected += 1;
          noteHit = tally(red.counts);
        } else if (typeof row.raw_text === 'string' && row.raw_text) {
          const red = redactSensitive(row.raw_text);
          if (tally(red.counts)) { r.textsAffected += 1; noteHit = true; }
        }
        if (noteHit) r.notesAffected += 1;
      }
    }
    return r;
  } finally {
    await db.query('ROLLBACK');
  }
}

export function formatTier1IndiaAudit(r: Tier1IndiaAuditResult): string[] {
  return [
    `notes scanned: ${r.notesScanned}`,
    `notes holding at least one value the P53 rules would now blank: ${r.notesAffected}`,
    `stored messages / note texts holding one: ${r.textsAffected}`,
    `by kind: Aadhaar ${r.byKind.aadhaar}, PAN ${r.byKind.pan}, passport ${r.byKind.passport}, bank account ${r.byKind.bank_account}`,
    'nothing was changed (read-only)',
  ];
}

async function main(): Promise<void> {
  parseTier1IndiaAuditArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      for (const line of formatTier1IndiaAudit(await runTier1IndiaAudit(client))) console.log(`[tier1-india-audit] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[tier1-india-audit] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
