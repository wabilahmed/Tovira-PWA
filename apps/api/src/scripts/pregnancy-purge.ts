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
import { cutPregnancy, cutPregnancyPointers, cutText, blankQuote, mentionsPregnancy } from '../services/privacy/pregnancy-cut.js';

/** A loose SQL prefilter; the exact decision is mentionsPregnancy(). */
export const PREFILTER = String.raw`(pregnan|expecting|baby|maternity|paternity|fertil|ivf|in.vitro|conceive|miscarr)`;

export const PURGE_SQL = {
  notes: `SELECT id, user_id, extracted FROM notes WHERE extracted IS NOT NULL AND extracted::text ~* $1`,
  keyDates: `SELECT id, user_id, description, date_raw, source_span FROM key_dates WHERE concat_ws(' ', description, date_raw, source_span) ~* $1`,
  promises: `SELECT id, user_id, source_span FROM promises WHERE source_span ~* $1`,
  meetings: `SELECT id, user_id, source_span FROM meetings WHERE source_span ~* $1`,
  requirements: `SELECT id, user_id, text, requirement_raw FROM requirements WHERE concat_ws(' ', text, requirement_raw) ~* $1`,
  pointers: `SELECT user_id, client_id, pointers FROM client_pointers WHERE pointers::text ~* $1`,
} as const;

export interface PurgeCounts {
  accounts: number;
  notes: number;
  /** items hard-deleted (nothing meaningful left) */
  dropped: number;
  /** items that kept their non-sensitive words */
  cut: number;
  quotesBlanked: number;
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

export async function runPregnancyPurge(db: Queryable, opts: { apply: boolean }): Promise<PurgeCounts> {
  const c: PurgeCounts = { accounts: 0, notes: 0, dropped: 0, cut: 0, quotesBlanked: 0 };
  const perUser = new Map<string, { dropped: number; cut: number; quotesBlanked: number }>();
  const tally = (userId: unknown, d: { dropped: number; cut: number; quotesBlanked: number }): void => {
    if (d.dropped + d.cut + d.quotesBlanked === 0) return;
    const u = perUser.get(String(userId)) ?? { dropped: 0, cut: 0, quotesBlanked: 0 };
    u.dropped += d.dropped; u.cut += d.cut; u.quotesBlanked += d.quotesBlanked;
    perUser.set(String(userId), u);
    c.dropped += d.dropped; c.cut += d.cut; c.quotesBlanked += d.quotesBlanked;
  };
  const writes: Array<[string, unknown[]]> = [];

  await db.query(opts.apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    for (const row of (await db.query(PURGE_SQL.notes, [PREFILTER])).rows) {
      const ex = JSON.parse(JSON.stringify(row.extracted)) as Parameters<typeof cutPregnancy>[0];
      const d = cutPregnancy(ex);
      if (d.dropped + d.cut + d.quotesBlanked === 0) continue;
      c.notes += 1;
      tally(row.user_id, d);
      writes.push(['UPDATE notes SET extracted = $2 WHERE id = $1', [row.id, JSON.stringify(ex)]]);
    }
    for (const row of (await db.query(PURGE_SQL.keyDates, [PREFILTER])).rows) {
      const desc = String(row.description ?? '');
      if (mentionsPregnancy(desc) && cutText(desc) === null) {
        tally(row.user_id, { dropped: 1, cut: 0, quotesBlanked: 0 });
        writes.push(['DELETE FROM key_dates WHERE id = $1', [row.id]]);
        continue;
      }
      const d = { dropped: 0, cut: mentionsPregnancy(desc) ? 1 : 0, quotesBlanked: 0 };
      const raw = typeof row.date_raw === 'string' && mentionsPregnancy(row.date_raw) ? (d.quotesBlanked++, blankQuote(row.date_raw)) : row.date_raw;
      const span = typeof row.source_span === 'string' && mentionsPregnancy(row.source_span) ? (d.quotesBlanked++, blankQuote(row.source_span)) : row.source_span;
      if (d.cut + d.quotesBlanked === 0) continue;
      tally(row.user_id, d);
      writes.push(['UPDATE key_dates SET description = $2, date_raw = $3, source_span = $4 WHERE id = $1', [row.id, cutText(desc), raw, span]]);
    }
    for (const table of ['promises', 'meetings'] as const) {
      for (const row of (await db.query(PURGE_SQL[table], [PREFILTER])).rows) {
        if (typeof row.source_span !== 'string' || !mentionsPregnancy(row.source_span)) continue;
        tally(row.user_id, { dropped: 0, cut: 0, quotesBlanked: 1 });
        writes.push([`UPDATE ${table} SET source_span = $2 WHERE id = $1`, [row.id, blankQuote(row.source_span)]]);
      }
    }
    for (const row of (await db.query(PURGE_SQL.requirements, [PREFILTER])).rows) {
      const text = String(row.text ?? '');
      const raw = String(row.requirement_raw ?? '');
      if (!mentionsPregnancy(text) && !mentionsPregnancy(raw)) continue;
      const next = cutText(text);
      if (next === null) {
        tally(row.user_id, { dropped: 1, cut: 0, quotesBlanked: 0 });
        writes.push(['DELETE FROM requirements WHERE id = $1', [row.id]]); // its inventory matches cascade
        continue;
      }
      tally(row.user_id, { dropped: 0, cut: next !== text ? 1 : 0, quotesBlanked: mentionsPregnancy(raw) ? 1 : 0 });
      writes.push(['UPDATE requirements SET text = $2, requirement_raw = $3, embedding = NULL WHERE id = $1', [row.id, next, blankQuote(raw)]]);
    }
    for (const row of (await db.query(PURGE_SQL.pointers, [PREFILTER])).rows) {
      const list = Array.isArray(row.pointers) ? (row.pointers as Array<{ text: string; receipts: Array<{ source_span: string }> }>) : [];
      const { pointers, counts } = cutPregnancyPointers(list);
      if (counts.dropped + counts.cut + counts.quotesBlanked === 0) continue;
      tally(row.user_id, counts);
      writes.push(['UPDATE client_pointers SET pointers = $3 WHERE user_id = $1 AND client_id = $2', [row.user_id, row.client_id, JSON.stringify(pointers)]]);
    }
    c.accounts = perUser.size;

    if (!opts.apply) { await db.query('ROLLBACK'); return c; }
    for (const [sql, params] of writes) await db.query(sql, params);
    for (const [userId, u] of perUser) {
      const categories = [
        { category: 'health_detail_deleted', deleted: u.dropped },
        { category: 'health_detail_cut', deleted: u.cut },
        { category: 'health_quote_blanked', deleted: u.quotesBlanked },
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
      console.log(`[pregnancy-purge] ${opts.apply ? 'APPLIED' : 'DRY RUN (nothing changed)'}: accounts ${r.accounts}, notes ${r.notes}, deleted ${r.dropped}, cut ${r.cut}, quotes blanked ${r.quotesBlanked}`);
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
