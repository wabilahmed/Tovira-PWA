/**
 * [P18-4] One-off, idempotent backfill: resolve the DUE DATE of existing promises that were captured
 * with only a raw phrase ("by Thursday", "next week") and never got a resolved `due_date` — the common
 * case being promises imported before P14-3 wired the deterministic date resolver into extraction.
 *
 * ELIGIBILITY — a promise is a candidate only if ALL hold:
 *   1. `due_date IS NULL` — there is nothing to overwrite (we NEVER touch a date already resolved).
 *   2. `due_raw IS NOT NULL` and non-empty — there is a phrase to resolve.
 *   3. `done = false` — a kept promise's date is history, not worth touching.
 *
 * The phrase is resolved by the SAME deterministic resolver extraction uses (resolveDueDate), against
 * the promise's OWN anchor: `source_message_at` (the message that produced it) when present, else the
 * row's `created_at`. Resolution NEVER guesses — a phrase that doesn't resolve to a concrete date (a bare
 * "next week", a relative phrase with no usable anchor) is reported as unresolved and LEFT NULL. A wrong
 * date is worse than a missing one (docs/tovira-spec.md product principles).
 *
 * DRY-RUN BY DEFAULT — prints every row it would set (id, phrase, anchor, resolved date) and a separate
 * unresolved section, and writes nothing. Pass --apply to write (one transaction, all-or-nothing).
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-promise-dates.ts
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-promise-dates.ts --apply
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { resolveDueDate } from '../services/extraction/resolve-date.js';

/** A promise row reduced to what the backfill needs: the phrase + the anchor day to resolve against. */
export interface PromiseRow {
  id: string;
  dueRaw: string;
  /** "YYYY-MM-DD" — the promise's own reference date (source_message_at, else created_at). */
  anchorDay: string;
}

export interface BackfillPlan {
  resolved: Array<{ id: string; dueRaw: string; anchorDay: string; dueDate: string }>;
  unresolved: Array<{ id: string; dueRaw: string; anchorDay: string }>;
}

/**
 * PURE backfill decision (unit-tested). `resolve` is the deterministic resolver — injected so the plan is
 * tested without a DB. A null resolution is ALWAYS reported as unresolved; it is never written as a date.
 */
export function planPromiseBackfill(
  rows: PromiseRow[],
  resolve: (dueRaw: string, anchorDay: string) => string | null,
): BackfillPlan {
  const plan: BackfillPlan = { resolved: [], unresolved: [] };
  for (const row of rows) {
    const dueDate = resolve(row.dueRaw, row.anchorDay);
    if (dueDate) plan.resolved.push({ id: row.id, dueRaw: row.dueRaw, anchorDay: row.anchorDay, dueDate });
    else plan.unresolved.push({ id: row.id, dueRaw: row.dueRaw, anchorDay: row.anchorDay });
  }
  return plan;
}

/** The leading YYYY-MM-DD of an ISO timestamp (or date), read positionally so a timezone can't drift the
 *  day. Null when there's nothing date-like to read. */
function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return m ? m[1]! : null;
}

/** Read-only candidate query — inspectable before any write. */
export const CANDIDATES_SQL = `
SELECT id,
       due_raw,
       source_message_at,
       created_at
  FROM promises
 WHERE due_date IS NULL
   AND due_raw IS NOT NULL
   AND btrim(due_raw) <> ''
   AND done = false
 ORDER BY created_at`;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }

  // [P17-SSL] Same pool factory the API uses (TLS for RDS, plain locally) — never a raw new pg.Pool.
  const pool = createPool(url);
  try {
    const { rows } = await pool.query<{ id: string; due_raw: string; source_message_at: Date | null; created_at: Date }>(CANDIDATES_SQL);
    const candidates: PromiseRow[] = rows.map((r) => ({
      id: r.id,
      dueRaw: r.due_raw,
      // The promise's own message date is the right anchor for a relative phrase; fall back to the row's
      // insert time only when the message date is absent (older rows predating source_message_at).
      anchorDay: dayOf(r.source_message_at ? r.source_message_at.toISOString() : null) ?? r.created_at.toISOString().slice(0, 10),
    }));

    const plan = planPromiseBackfill(candidates, (dueRaw, anchorDay) => resolveDueDate(dueRaw, anchorDay).date);

    console.log(`[backfill-promise-dates] ${candidates.length} candidate(s) with a phrase and no resolved date.`);
    console.log(`[backfill-promise-dates] RESOLVED (${plan.resolved.length}) — would set due_date:`);
    for (const r of plan.resolved) console.log(`  + ${r.id}  "${r.dueRaw}"  anchor=${r.anchorDay}  → ${r.dueDate}`);
    console.log(`[backfill-promise-dates] UNRESOLVED (${plan.unresolved.length}) — left NULL (never guessed):`);
    for (const r of plan.unresolved) console.log(`  - ${r.id}  "${r.dueRaw}"  anchor=${r.anchorDay}`);

    if (!apply) {
      console.log('[backfill-promise-dates] DRY RUN — no writes. Re-run with --apply to set the resolved dates.');
      return;
    }

    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const r of plan.resolved) {
        // Guard due_date IS NULL again inside the write so a concurrent resolution is never clobbered.
        const res = await client.query(`UPDATE promises SET due_date = $2 WHERE id = $1 AND due_date IS NULL`, [r.id, r.dueDate]);
        updated += (res as { rowCount: number }).rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`[backfill-promise-dates] set ${updated} due date(s) (of ${plan.resolved.length} resolvable candidate(s)).`);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[backfill-promise-dates] failed', e); process.exit(1); });
}
