/**
 * [P26-2] READ-ONLY check before turning on EXTRACT_WINDOWED: did the P23 windowed path auto-close any
 * promise? Since P24 a detected delivery only SUGGESTS (To Confirm); before that, the windowed path could
 * set a promise done from the model's `kept_at`. Windowing was never on in prod, so both are expected small
 * and the first is expected ZERO. Prints two COUNTS only — no promise text, no ids — inside one
 * READ ONLY transaction that is rolled back. It has nothing to write and refuses --apply.
 *   Local:   DATABASE_URL=… npx tsx apps/api/src/scripts/kept-promise-check.ts
 *   In prod: scripts/ops/run-backfill.sh --script kept-promise-check
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';

/** Promises marked done whose note's extraction carries a `kept_at` on a promise with the same text. */
export const KEPT_AUTOCLOSED_COUNT_SQL = `
SELECT count(*) AS n
  FROM promises p JOIN notes n ON n.id = p.note_id
 WHERE p.done = true
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(n.extracted->'promises', '[]'::jsonb)) AS e
                WHERE e->>'kept_at' IS NOT NULL AND lower(btrim(e->>'text')) = lower(btrim(p.text)))`;

/** Notes whose stored extraction has any promise with a model `kept_at`. */
export const NOTES_WITH_KEPT_AT_SQL = `
SELECT count(*) AS n
  FROM notes
 WHERE jsonb_path_exists(COALESCE(extracted, '{}'::jsonb), '$.promises[*].kept_at')`;

export interface KeptCheckResult { autoClosedPromises: number; notesWithKeptAt: number }
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parseKeptCheckArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('kept-promise-check is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (kept-promise-check takes none; it is read-only)`);
  }
  return {};
}

/** Both counts in ONE read-only transaction, always rolled back. */
export async function runKeptPromiseCheck(db: Queryable): Promise<KeptCheckResult> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    const a = await db.query(KEPT_AUTOCLOSED_COUNT_SQL);
    const b = await db.query(NOTES_WITH_KEPT_AT_SQL);
    return { autoClosedPromises: Number(a.rows[0]?.n ?? 0), notesWithKeptAt: Number(b.rows[0]?.n ?? 0) };
  } finally {
    await db.query('ROLLBACK');
  }
}

export function formatKeptCheck(r: KeptCheckResult): string[] {
  return [
    `auto-closed promises (done + matching model kept_at): ${r.autoClosedPromises}`,
    `notes with a model kept_at: ${r.notesWithKeptAt}`,
    r.autoClosedPromises === 0
      ? 'OK — nothing was auto-closed.'
      : `NOT ZERO — ${r.autoClosedPromises} promise(s) look auto-closed; review before turning on EXTRACT_WINDOWED.`,
  ];
}

async function main(): Promise<void> {
  parseKeptCheckArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      for (const line of formatKeptCheck(await runKeptPromiseCheck(client))) console.log(`[kept-promise-check] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[kept-promise-check] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
