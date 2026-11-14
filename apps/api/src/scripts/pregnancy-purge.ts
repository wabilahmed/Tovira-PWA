/**
 * [P69-15 · owner] Purge stored pregnancy details (pregnancy, expecting, a baby on the way, maternity/paternity,
 * fertility, IVF) from every account, with the same cut the store-time block (P69-14) now applies to new captures.
 *
 * Reaches every stored copy: the note's extraction JSON, the key_dates / promises / meetings rows (receipt quotes),
 * the requirements spine, and the pointer sets. Doctrine: remove words, never add or change them. An item left with
 * nothing meaningful is hard-deleted; a mixed item keeps its non-sensitive words; a receipt quote is blanked with
 * [health detail redacted]. A requirement whose words changed loses its vector (it was computed from the removed
 * words), so matching skips it rather than match on them.
 *
 * Like an erasure, each affected account gets an erasure_audit row with category counts only (no content, no names).
 *
 *   Dry run (default, READ ONLY, rolled back): counts only.  scripts/ops/run-backfill.sh --script pregnancy-purge
 *   Apply (one transaction):                                  scripts/ops/run-backfill.sh --script pregnancy-purge --apply
 * It prints counts only, never content, ids or names.
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { cutPregnancy, cutPregnancyPointers, cutText, blankQuote, mentionsPregnancy, isPregnancyDueDate } from '../services/privacy/pregnancy-cut.js';

/** A loose SQL prefilter; the exact decision is mentionsPregnancy() / isPregnancyDueDate(). */
export const PREFILTER = String.raw`(pregnan|expecting|baby|maternity|paternity|fertil|ivf|in.vitro|conceive|miscarr|due\s+date)`;

export const PURGE_SQL = {
  notes: `SELECT id, user_id, extracted FROM notes WHERE extracted IS NOT NULL AND extracted::text ~* $1`,
  keyDates: `SELECT id, user_id, description, date_raw, type, source_span FROM key_dates WHERE concat_ws(' ', description, date_raw, source_span) ~* $1`,
  promises: `SELECT id, user_id, text, source_span FROM promises WHERE concat_ws(' ', text, source_span) ~* $1`,
  meetings: `SELECT id, user_id, source_span FROM meetings WHERE source_span ~* $1`,
  requirements: `SELECT id, user_id, text, requirement_raw FROM requirements WHERE concat_ws(' ', text, requirement_raw) ~* $1`,
  pointers: `SELECT user_id, client_id, pointers FROM client_pointers WHERE pointers::text ~* $1`,
} as const;

/**
 * Counts by kind, each item once. A date, ask or promise is stored twice (the note's extraction JSON and its own row):
 * both copies are fixed, the row is what is counted. Details (personal facts, worries, people's roles) live only in the
 * JSON and are counted there.
 */
export interface PurgeCounts {
  accounts: number;
  notes: number;
  detailsDeleted: number;
  detailsCut: number;
  asksDeleted: number;
  asksCut: number;
  datesDeleted: number;
  datesCut: number;
  promisesBlanked: number;
  quotesBlanked: number;
  pointersDeleted: number;
  pointersCut: number;
}

interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function parsePregnancyPurgeArgs(argv: string[]): { apply: boolean } {
  let apply = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else throw new Error(`unknown argument: ${a} (pregnancy-purge takes only --apply)`);
  }
  return { apply };
}

export function formatPurge(r: PurgeCounts, apply: boolean): string {
  return `[pregnancy-purge] ${apply ? 'APPLIED' : 'DRY RUN (nothing changed)'}: accounts ${r.accounts}, notes ${r.notes} · details deleted ${r.detailsDeleted}, cut ${r.detailsCut} · asks deleted ${r.asksDeleted}, cut ${r.asksCut} · dates deleted ${r.datesDeleted}, cut ${r.datesCut} · promises blanked ${r.promisesBlanked} · quotes blanked ${r.quotesBlanked} · pointers deleted ${r.pointersDeleted}, cut ${r.pointersCut}`;
}

export async function runPregnancyPurge(db: Queryable, opts: { apply: boolean }): Promise<PurgeCounts> {
  const c: PurgeCounts = { accounts: 0, notes: 0, detailsDeleted: 0, detailsCut: 0, asksDeleted: 0, asksCut: 0, datesDeleted: 0, datesCut: 0, promisesBlanked: 0, quotesBlanked: 0, pointersDeleted: 0, pointersCut: 0 };
  const perUser = new Map<string, { deleted: number; cut: number; blanked: number }>();
  const touch = (userId: unknown, d: { deleted?: number; cut?: number; blanked?: number }): void => {
    const u = perUser.get(String(userId)) ?? { deleted: 0, cut: 0, blanked: 0 };
    u.deleted += d.deleted ?? 0; u.cut += d.cut ?? 0; u.blanked += d.blanked ?? 0;
    perUser.set(String(userId), u);
  };
  const writes: Array<[string, unknown[]]> = [];
  const has = (v: unknown): v is string => typeof v === 'string' && mentionsPregnancy(v);

  await db.query(opts.apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    for (const row of (await db.query(PURGE_SQL.notes, [PREFILTER])).rows) {
      const ex = JSON.parse(JSON.stringify(row.extracted)) as Parameters<typeof cutPregnancy>[0];
      // Details live only here: counted. Dates, asks, promises and the meeting are counted on their own rows below.
      const dPart = { personal_facts: ex.personal_facts, concerns: ex.concerns, people: ex.people };
      const cPart = { key_dates: ex.key_dates, requirements: ex.requirements, promises: ex.promises, meeting: ex.meeting };
      const details = cutPregnancy(dPart);
      const copies = cutPregnancy(cPart);
      const changed = details.dropped + details.cut + details.quotesBlanked + copies.dropped + copies.cut + copies.quotesBlanked + copies.promisesBlanked;
      if (changed === 0) continue;
      // The cut filters arrays by replacing them on the object it was given, and sets every key it knows (absent ones to
      // undefined), so write back each part's OWN keys only: merging the parts let cPart's undefined personal_facts
      // overwrite the cut list (caught by the real-Postgres test).
      const out = ex as Record<string, unknown>;
      for (const k of ['personal_facts', 'concerns', 'people'] as const) if (dPart[k] !== undefined) out[k] = dPart[k];
      for (const k of ['key_dates', 'requirements', 'promises', 'meeting'] as const) if (cPart[k] !== undefined) out[k] = cPart[k];
      c.notes += 1;
      c.detailsDeleted += details.dropped; c.detailsCut += details.cut; c.quotesBlanked += details.quotesBlanked;
      touch(row.user_id, { deleted: details.dropped, cut: details.cut, blanked: details.quotesBlanked });
      writes.push(['UPDATE notes SET extracted = $2 WHERE id = $1', [row.id, JSON.stringify(ex)]]);
    }
    for (const row of (await db.query(PURGE_SQL.keyDates, [PREFILTER])).rows) {
      const desc = String(row.description ?? '');
      if (isPregnancyDueDate(desc, row.type) || (has(desc) && cutText(desc) === null)) {
        c.datesDeleted += 1; touch(row.user_id, { deleted: 1 });
        writes.push(['DELETE FROM key_dates WHERE id = $1', [row.id]]);
        continue;
      }
      const cut = has(desc) ? 1 : 0;
      const blanked = (has(row.date_raw) ? 1 : 0) + (has(row.source_span) ? 1 : 0);
      if (cut + blanked === 0) continue;
      c.datesCut += cut; c.quotesBlanked += blanked; touch(row.user_id, { cut, blanked });
      writes.push(['UPDATE key_dates SET description = $2, date_raw = $3, source_span = $4 WHERE id = $1', [row.id, cutText(desc), has(row.date_raw) ? blankQuote(row.date_raw) : row.date_raw, has(row.source_span) ? blankQuote(row.source_span) : row.source_span]]);
    }
    for (const row of (await db.query(PURGE_SQL.promises, [PREFILTER])).rows) {
      const text = has(row.text) ? 1 : 0;
      const span = has(row.source_span) ? 1 : 0;
      if (text + span === 0) continue;
      c.promisesBlanked += text; c.quotesBlanked += span; touch(row.user_id, { blanked: text + span });
      writes.push(['UPDATE promises SET text = $2, source_span = $3 WHERE id = $1', [row.id, text ? blankQuote(String(row.text)) : row.text, span ? blankQuote(String(row.source_span)) : row.source_span]]);
    }
    for (const row of (await db.query(PURGE_SQL.meetings, [PREFILTER])).rows) {
      if (!has(row.source_span)) continue;
      c.quotesBlanked += 1; touch(row.user_id, { blanked: 1 });
      writes.push(['UPDATE meetings SET source_span = $2 WHERE id = $1', [row.id, blankQuote(row.source_span)]]);
    }
    for (const row of (await db.query(PURGE_SQL.requirements, [PREFILTER])).rows) {
      const text = String(row.text ?? '');
      const raw = String(row.requirement_raw ?? '');
      if (!has(text) && !has(raw)) continue;
      const next = cutText(text);
      if (next === null) {
        c.asksDeleted += 1; touch(row.user_id, { deleted: 1 });
        writes.push(['DELETE FROM requirements WHERE id = $1', [row.id]]); // its inventory matches cascade
        continue;
      }
      const cut = next !== text ? 1 : 0;
      const blanked = has(raw) ? 1 : 0;
      c.asksCut += cut; c.quotesBlanked += blanked; touch(row.user_id, { cut, blanked });
      // its vector was computed from the removed words, so it goes; matching skips a requirement with no vector
      writes.push(['UPDATE requirements SET text = $2, requirement_raw = $3, embedding = NULL WHERE id = $1', [row.id, next, blankQuote(raw)]]);
    }
    for (const row of (await db.query(PURGE_SQL.pointers, [PREFILTER])).rows) {
      const list = Array.isArray(row.pointers) ? (row.pointers as Array<{ text: string; receipts: Array<{ source_span: string }> }>) : [];
      const { pointers, counts } = cutPregnancyPointers(list);
      if (counts.dropped + counts.cut + counts.quotesBlanked === 0) continue;
      c.pointersDeleted += counts.dropped; c.pointersCut += counts.cut; c.quotesBlanked += counts.quotesBlanked;
      touch(row.user_id, { deleted: counts.dropped, cut: counts.cut, blanked: counts.quotesBlanked });
      writes.push(['UPDATE client_pointers SET pointers = $3 WHERE user_id = $1 AND client_id = $2', [row.user_id, row.client_id, JSON.stringify(pointers)]]);
    }
    c.accounts = perUser.size;

    if (!opts.apply) { await db.query('ROLLBACK'); return c; }
    for (const [sql, params] of writes) await db.query(sql, params);
    for (const [userId, u] of perUser) {
      const categories = [
        { category: 'health_detail_deleted', deleted: u.deleted },
        { category: 'health_detail_cut', deleted: u.cut },
        { category: 'health_detail_blanked', deleted: u.blanked },
      ].filter((x) => x.deleted > 0);
      await db.query('INSERT INTO erasure_audit (user_id, requester_names, categories) VALUES ($1, $2, $3::jsonb)', [userId, [], JSON.stringify(categories)]);
    }
    await db.query('COMMIT');
    return c;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

async function main(): Promise<void> {
  const opts = parsePregnancyPurgeArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect(); // one connection, so the transaction holds
    try {
      const r = await runPregnancyPurge(client, opts);
      console.log(formatPurge(r, opts.apply));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('[pregnancy-purge] failed:', err instanceof Error ? err.message : err); process.exit(1); });
}
