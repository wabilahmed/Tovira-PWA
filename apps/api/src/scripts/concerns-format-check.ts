/**
 * [P90-4 · owner, Prompt 88] READ-ONLY: how many stored notes hold a concern that is not plain text. The pre-meeting
 * brief crashed on the repo demo seed's old shape (`concerns: [{ text }]`); the extraction pipeline stores plain strings,
 * but the stored-output check only requires a list. Counts only (no note text, no concern text, no email, no id):
 * notes, such concerns, the accounts they belong to, and notes whose concerns field is not a list at all.
 * One READ ONLY transaction, rolled back. Refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/concerns-format-check.ts
 *   In prod: scripts/ops/run-backfill.sh --script concerns-format-check
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';

export const CONCERNS_FORMAT_SQL = `
SELECT count(DISTINCT n.id) FILTER (WHERE jsonb_typeof(c.value) <> 'string') AS notes,
       count(*) FILTER (WHERE jsonb_typeof(c.value) <> 'string') AS items,
       count(DISTINCT n.user_id) FILTER (WHERE jsonb_typeof(c.value) <> 'string') AS accounts,
       count(DISTINCT n.id) FILTER (WHERE n.extracted ? 'concerns' AND jsonb_typeof(n.extracted->'concerns') <> 'array') AS not_a_list,
       count(DISTINCT n.id) AS notes_checked
FROM notes n
LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n.extracted->'concerns') = 'array' THEN n.extracted->'concerns' ELSE '[]'::jsonb END) AS c(value) ON true
WHERE n.extracted IS NOT NULL AND jsonb_typeof(n.extracted) = 'object'`;

export interface ConcernsResult { notes: number; items: number; accounts: number; notAList: number; notesChecked: number }
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parseConcernsArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('concerns-format-check is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (concerns-format-check takes none; it is read-only)`);
  }
  return {};
}

export async function runConcernsCheck(db: Queryable): Promise<ConcernsResult> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    const r = (await db.query(CONCERNS_FORMAT_SQL)).rows[0] ?? {};
    return { notes: Number(r.notes ?? 0), items: Number(r.items ?? 0), accounts: Number(r.accounts ?? 0), notAList: Number(r.not_a_list ?? 0), notesChecked: Number(r.notes_checked ?? 0) };
  } finally {
    await db.query('ROLLBACK');
  }
}

export function formatConcerns(r: ConcernsResult): string[] {
  return [
    `notes checked (with an extraction): ${r.notesChecked}`,
    `notes with a concern that is not plain text: ${r.notes}`,
    `such concerns in total: ${r.items}`,
    `accounts they belong to: ${r.accounts}`,
    `notes whose concerns field is not a list: ${r.notAList}`,
  ];
}

async function main(): Promise<void> {
  parseConcernsArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      for (const line of formatConcerns(await runConcernsCheck(client))) console.log(`[concerns-format] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[concerns-format] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
