/**
 * [P21-C] RE-DATE mode (what main() now runs): every OPEN, live, canonical promise with a phrase is
 * re-resolved with the current resolver (P14 message anchor, P18 strictly-after weekdays + Arabic, the
 * chat's day-first order) — so a date resolved by an older, wrong rule ("Monday" said on a Monday → the
 * same day) is corrected, not only a missing one filled. Rules:
 *   - NEVER overwrites a rep-edited value: a promise with a 'due_date' / 'due_raw' edit in corrections is
 *     skipped (and listed).
 *   - NEVER touches the model's own fields: notes.extracted (the model's due_date + the resolution it was
 *     given) is not written; only the surfaced promises.due_date changes.
 *   - NEVER guesses: an unresolvable phrase, or one that would fall before its own message, leaves the
 *     stored date exactly as it is.
 *   - IDEMPOTENT: an already-correct date is not a change; the write is guarded on the value it read.
 * Dry run prints one line per change: id, raw phrase, old → new. `--only-user <uuid>` scopes to one rep.
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-promise-dates.ts [--only-user <uuid>]
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-promise-dates.ts [--only-user <uuid>] --apply
 *   In prod:  scripts/ops/run-backfill.sh --script promise-dates [--only-user <uuid>] [--apply]
 *
 * [P18-4] (original) One-off, idempotent backfill: resolve the DUE DATE of existing promises that were captured
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
import { resolveDueDate, messageDay } from '../services/extraction/resolve-date.js';
import { trustedPromiseDate } from '../services/extraction/date-policy.js';

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
 * [P18-4] The original fill-only decision (nulls only), kept as the pure core its tests pin; main() now
 * runs the P21-C re-date below, which covers this case too. PURE backfill decision (unit-tested). `resolve` is the deterministic resolver — injected so the plan is
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

/** [P21-C] CLI flags shared by the re-date backfills. Throws on anything unexpected (fail closed). */
export function parseBackfillArgs(argv: string[]): { apply: boolean; onlyUser: string | null } {
  let apply = false;
  let onlyUser: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') apply = true;
    else if (a === '--only-user') {
      const id = argv[++i];
      if (!id) throw new Error('--only-user needs a user id');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error(`--only-user expects a uuid, got "${id}"`);
      onlyUser = id;
    } else throw new Error(`unknown argument: ${a} (expected --only-user <uuid>, --apply)`);
  }
  return { apply, onlyUser };
}

/** [P21-C] One promise as the re-date sees it. `anchor` = source_message_at, else the conversation date
 *  (capture_at), else created_at. `dayFirst` = the note is a WhatsApp export (the order extraction uses). */
export interface PromiseRedateRow {
  id: string;
  userId: string;
  dueRaw: string;
  dueDate: string | null;
  anchor: string;
  dayFirst: boolean;
  repEdited: boolean;
  /** [P40-1] for the to-confirm list: the client's name and the stored receipt quote. */
  clientName?: string | null;
  sourceSpan?: string | null;
  /** [P43-1] the corrections behind a rep-edited flag (metadata only: no before/after values exist). */
  edits?: RepEdit[];
}

/** [P43-1] One recorded edit of the date or phrase: which field, the verdict, its kind, the day shift and when. */
export interface RepEdit { field: string; verdict: string | null; kind: string | null; deltaDays: number | null; at: string }

/** [P40-1] A stored date that came from the model with no resolver match → null + date to confirm. */
export interface PromiseToConfirm { id: string; userId: string; client: string; dueRaw: string; from: string; receiptDate: string | null }

export interface PromiseChange { id: string; userId: string; dueRaw: string; from: string | null; to: string }

export interface PromiseRedatePlan {
  changes: PromiseChange[];
  /** [P40-1] stored model dates the resolver can't reproduce (and the receipt doesn't state) → null + to confirm. */
  toConfirm: PromiseToConfirm[];
  unresolved: Array<{ id: string; dueRaw: string }>;
  skippedRepEdited: Array<{ id: string; dueRaw: string; edits?: RepEdit[] }>;
}

/** PURE re-date decision (unit-tested with the real resolver). */
export function planPromiseRedate(rows: PromiseRedateRow[]): PromiseRedatePlan {
  const plan: PromiseRedatePlan = { changes: [], toConfirm: [], unresolved: [], skippedRepEdited: [] };
  for (const r of rows) {
    if (r.repEdited) { plan.skippedRepEdited.push({ id: r.id, dueRaw: r.dueRaw, ...(r.edits ? { edits: r.edits } : {}) }); continue; }
    const to = resolveDueDate(r.dueRaw, r.anchor, { dayFirst: r.dayFirst }).date;
    const said = messageDay(r.anchor);
    // Unresolvable, or impossible (due before the message that made it — the DATE-INVARIANT).
    if (!to || (said !== null && to < said)) {
      // [P40-1] A stored date here came from the model, not the resolver: unless the receipt itself states that exact
      // date (and the resolver reads it the same), it becomes null + date to confirm. An undated row is left alone.
      const stated = r.dueDate !== null && trustedPromiseDate(
        { text: '', owner: 'rep', confidence: 'high', due_raw: r.dueRaw, due_date: r.dueDate, resolved_due_date: null, source_span: r.sourceSpan ?? null },
        { dayFirst: r.dayFirst },
      ).date === r.dueDate;
      if (r.dueDate !== null && !stated) plan.toConfirm.push({ id: r.id, userId: r.userId, client: r.clientName ?? '', dueRaw: r.dueRaw, from: r.dueDate, receiptDate: said });
      else plan.unresolved.push({ id: r.id, dueRaw: r.dueRaw });
      continue;
    }
    if (to === r.dueDate) continue; // already right — idempotent
    plan.changes.push({ id: r.id, userId: r.userId, dueRaw: r.dueRaw, from: r.dueDate, to });
  }
  return plan;
}

/** [P43-1] The dry-run line for a rep-edited skip, with the edit(s) that make it one. */
export function formatRepEdited(r: { id: string; dueRaw: string; edits?: RepEdit[] }): string {
  const why = (r.edits ?? []).map((e) => `${e.field} ${e.verdict ?? 'edit'} (${[e.kind, e.deltaDays !== null ? `${e.deltaDays > 0 ? '+' : ''}${e.deltaDays} days` : null].filter(Boolean).join(', ') || 'no detail'}) on ${e.at.slice(0, 10)} ${e.at.slice(11, 16)} UTC`);
  return `= ${r.id}  "${r.dueRaw}"${why.length ? `  rep edit: ${why.join('; ')}` : ''}`;
}

/** The dry-run line for one change: id, raw phrase, old → new. */
export function formatPromiseChange(c: PromiseChange): string {
  return `~ ${c.id}  "${c.dueRaw}"  ${c.from ?? '(none)'} → ${c.to}`;
}

/** [P40-1] The dry-run line for one to-confirm row: id, client, phrase, stored date, receipt date, the action. */
export function formatToConfirm(t: PromiseToConfirm): string {
  return `? ${t.id}  ${t.client}  "${t.dueRaw}"  stored ${t.from}  said ${t.receiptDate ?? '(unknown)'}  → null + date to confirm`;
}

/** [P21-C] Read-only candidates: open, live, canonical promises with a phrase; flags a rep edit of the
 *  date/phrase; $1 = --only-user (NULL = every rep). */
export const PROMISE_CANDIDATES_SQL = `
SELECT p.id, p.user_id, p.due_raw, p.due_date::text AS due_date, p.source_message_at, p.capture_at, p.created_at,
       p.source_span, cl.name AS client_name,
       (n.source = 'whatsapp_export') AS day_first,
       EXISTS (SELECT 1 FROM corrections c
                WHERE c.entity_type = 'promise' AND c.entity_id = p.id
                  AND c.field IN ('due_date', 'due_raw')) AS rep_edited,
       (SELECT json_agg(json_build_object('field', c.field, 'verdict', c.verdict, 'kind', c.correction_kind,
                                          'deltaDays', c.date_delta_days, 'at', c.created_at) ORDER BY c.created_at)
          FROM corrections c
         WHERE c.entity_type = 'promise' AND c.entity_id = p.id
           AND c.field IN ('due_date', 'due_raw')) AS edits
  FROM promises p
  LEFT JOIN notes n ON n.id = p.note_id
  LEFT JOIN clients cl ON cl.id = p.client_id
 WHERE p.done = false
   AND p.deleted_at IS NULL
   AND p.merged_into IS NULL
   AND p.due_raw IS NOT NULL
   AND btrim(p.due_raw) <> ''
   AND ($1::uuid IS NULL OR p.user_id = $1)
 ORDER BY p.user_id, p.created_at`;

/** The only write: the surfaced due date, guarded on the value the dry run read (never clobbers a
 *  concurrent rep edit; a re-run is a no-op). */
export const PROMISE_UPDATE_SQL = 'UPDATE promises SET due_date = $2 WHERE id = $1 AND due_date IS NOT DISTINCT FROM $3::date';
/** [P40-1] A model date with no resolver match: null + date to confirm, guarded on the value the dry run read. */
export const PROMISE_TO_CONFIRM_SQL = "UPDATE promises SET due_date = NULL, date_status = 'to_confirm' WHERE id = $1 AND due_date IS NOT DISTINCT FROM $2::date";

function anchorOf(sourceMessageAt: Date | null, captureAt: string | null, createdAt: Date): string {
  return sourceMessageAt ? sourceMessageAt.toISOString() : captureAt ?? createdAt.toISOString();
}

async function main(): Promise<void> {
  const { apply, onlyUser } = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }

  // [P17-SSL] Same pool factory the API uses (TLS for RDS, plain locally) — never a raw new pg.Pool.
  const pool = createPool(url);
  try {
    const { rows } = await pool.query<{ id: string; user_id: string; due_raw: string; due_date: string | null; source_message_at: Date | null; capture_at: string | null; created_at: Date; day_first: boolean | null; rep_edited: boolean; source_span: string | null; client_name: string | null; edits: Array<{ field: string; verdict: string | null; kind: string | null; deltaDays: number | null; at: string }> | null }>(PROMISE_CANDIDATES_SQL, [onlyUser]);
    const plan = planPromiseRedate(rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      dueRaw: r.due_raw,
      dueDate: r.due_date, // read as text: a `date` parsed to a JS Date is local midnight and shifts off-UTC
      anchor: anchorOf(r.source_message_at, r.capture_at, r.created_at),
      dayFirst: r.day_first === true,
      repEdited: r.rep_edited,
      clientName: r.client_name,
      sourceSpan: r.source_span,
      ...(r.edits ? { edits: r.edits.map((e) => ({ ...e, at: new Date(e.at).toISOString() })) } : {}),
    })));

    const scope = onlyUser ? `user ${onlyUser}` : 'all users';
    console.log(`[backfill-promise-dates] ${rows.length} open promise(s) with a phrase (${scope}).`);
    console.log(`[backfill-promise-dates] CHANGES (${plan.changes.length}):`);
    for (const c of plan.changes) console.log(`  ${formatPromiseChange(c)}`);
    console.log(`[backfill-promise-dates] MODEL DATE, NO RESOLVER MATCH → null + date to confirm (${plan.toConfirm.length}):`);
    for (const t of plan.toConfirm) console.log(`  ${formatToConfirm(t)}`);
    console.log(`[backfill-promise-dates] SKIPPED — rep-edited (${plan.skippedRepEdited.length}):`);
    for (const r of plan.skippedRepEdited) console.log(`  ${formatRepEdited(r)}`);
    console.log(`[backfill-promise-dates] UNRESOLVED — left as stored, never guessed (${plan.unresolved.length}):`);
    for (const r of plan.unresolved) console.log(`  - ${r.id}  "${r.dueRaw}"`);

    if (!apply) {
      console.log('[backfill-promise-dates] DRY RUN — no writes. Re-run with --apply to write the changes and to-confirms above.');
      return;
    }

    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const c of plan.changes) {
        const res = await client.query(PROMISE_UPDATE_SQL, [c.id, c.to, c.from]);
        updated += (res as { rowCount: number }).rowCount ?? 0;
      }
      for (const t of plan.toConfirm) {
        const res = await client.query(PROMISE_TO_CONFIRM_SQL, [t.id, t.from]);
        updated += (res as { rowCount: number }).rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`[backfill-promise-dates] updated ${updated} of ${plan.changes.length + plan.toConfirm.length} planned change(s).`);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[backfill-promise-dates] failed', e); process.exit(1); });
}
