/**
 * [P43 · owner] One-off, idempotent backfill: open promises and meetings stored before migrations 0093/0094 with no
 * date ("before you travel", "next week", "the 5th", a meeting on "Saturday" with no time) were never marked
 * date_status = 'to_confirm', so the rep was never asked "When is it due?". This marks them, so the question card
 * appears (only for items said within the last 90 days; older ones keep the "Date to confirm" label, as P40 decided).
 *
 * Rules:
 *   - NEVER writes a date. The only write is date_status = 'to_confirm', guarded on the row still being undated and
 *     unanswered (a row the rep dated or answered since the dry run is untouched).
 *   - NEVER marks a rep-edited row (a due_date / due_raw / datetime edit in corrections), a row the rep already
 *     answered ('not_sure', 'no_due_date', 'no_date'), or a rep-confirmed meeting.
 *   - A phrase the deterministic resolver CAN read is not marked here: it is listed for promise-dates /
 *     meeting-dates, which give it its date. (Marking it would leave a dated row flagged "to confirm".)
 *   - Model-proposed meetings only (note_id set). A meeting the rep entered is never touched.
 * Dry run is the default and writes nothing. `--only-user <uuid>` scopes to one rep. `--apply` writes, in one
 * transaction (all or nothing).
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-undated-to-confirm.ts [--only-user <uuid>]
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-undated-to-confirm.ts [--only-user <uuid>] --apply
 *   In prod:  scripts/ops/run-backfill.sh --script undated-to-confirm [--only-user <uuid>] [--apply]
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { resolveDateTime, resolveDueDate } from '../services/extraction/resolve-date.js';
import { zonedWallClockToInstant } from '../services/time/zone.js';
import { withinDateCardWindow } from '../services/facts/date-confirm-window.js';
import { parseBackfillArgs } from './backfill-promise-dates.js';

export interface UndatedPromiseRow {
  id: string; userId: string; clientName: string | null; dueRaw: string;
  /** source_message_at, else the conversation date (capture_at), else created_at — the anchor promise-dates uses. */
  anchor: string; dayFirst: boolean; repEdited: boolean; dateStatus: string | null;
}
export interface UndatedMeetingRow {
  id: string; userId: string; clientName: string | null; datetimeRaw: string;
  anchor: string; dayFirst: boolean; timezone: string; repEdited: boolean; confirmed: boolean; dateStatus: string | null;
}
/** One row to mark. `card` = said within the 90-day card window (else it keeps the label only). */
export interface UndatedMark { id: string; userId: string; client: string; raw: string; said: string | null; card: boolean }
export interface UndatedPlan {
  promises: UndatedMark[];
  meetings: UndatedMark[];
  /** The resolver reads these: left to promise-dates / meeting-dates. */
  resolvable: Array<{ kind: 'promise' | 'meeting'; id: string; raw: string }>;
  skipped: Array<{ kind: 'promise' | 'meeting'; id: string; raw: string; why: 'rep-edited' | 'rep-confirmed' }>;
}

const dayOf = (anchor: string): string | null => /^\d{4}-\d{2}-\d{2}/.exec(anchor)?.[0] ?? null;

/** PURE decision (unit-tested with the real resolver). */
export function planUndatedToConfirm(rows: { promises: UndatedPromiseRow[]; meetings: UndatedMeetingRow[] }, nowMs: number): UndatedPlan {
  const plan: UndatedPlan = { promises: [], meetings: [], resolvable: [], skipped: [] };
  const mark = (r: { id: string; userId: string; clientName: string | null; anchor: string }, raw: string): UndatedMark =>
    ({ id: r.id, userId: r.userId, client: r.clientName ?? '', raw, said: dayOf(r.anchor), card: withinDateCardWindow(r.anchor, nowMs) });
  for (const r of rows.promises) {
    if (r.dateStatus !== null) continue; // already waiting, or answered
    if (r.repEdited) { plan.skipped.push({ kind: 'promise', id: r.id, raw: r.dueRaw, why: 'rep-edited' }); continue; }
    if (resolveDueDate(r.dueRaw, r.anchor, { dayFirst: r.dayFirst }).date) { plan.resolvable.push({ kind: 'promise', id: r.id, raw: r.dueRaw }); continue; }
    plan.promises.push(mark(r, r.dueRaw));
  }
  for (const r of rows.meetings) {
    if (r.dateStatus !== null) continue;
    if (r.repEdited) { plan.skipped.push({ kind: 'meeting', id: r.id, raw: r.datetimeRaw, why: 'rep-edited' }); continue; }
    if (r.confirmed) { plan.skipped.push({ kind: 'meeting', id: r.id, raw: r.datetimeRaw, why: 'rep-confirmed' }); continue; }
    const wall = resolveDateTime(r.datetimeRaw, r.anchor, { dayFirst: r.dayFirst }).datetime;
    let readable = false;
    if (wall) { try { zonedWallClockToInstant(wall, r.timezone); readable = true; } catch { readable = false; } }
    if (readable) { plan.resolvable.push({ kind: 'meeting', id: r.id, raw: r.datetimeRaw }); continue; }
    plan.meetings.push(mark(r, r.datetimeRaw));
  }
  return plan;
}

/** The dry-run line: id, client, phrase, the day it was said, and whether the rep gets a card or only the label. */
export function formatMark(_kind: 'promise' | 'meeting', t: UndatedMark): string {
  return `? ${t.id}  ${t.client}  "${t.raw}"  said ${t.said ?? '(unknown)'}  → date to confirm (${t.card ? 'card' : 'label only, older than 90 days'})`;
}

/** Read-only: open, live, canonical, undated, never-asked promises with a phrase; flags a rep edit; $1 = --only-user. */
export const PROMISE_UNDATED_SQL = `
SELECT p.id, p.user_id, p.due_raw, p.date_status, p.source_message_at, p.capture_at, p.created_at,
       cl.name AS client_name,
       (n.source = 'whatsapp_export') AS day_first,
       EXISTS (SELECT 1 FROM corrections c
                WHERE c.entity_type = 'promise' AND c.entity_id = p.id
                  AND c.field IN ('due_date', 'due_raw')) AS rep_edited
  FROM promises p
  LEFT JOIN notes n ON n.id = p.note_id
  LEFT JOIN clients cl ON cl.id = p.client_id
 WHERE p.done = false
   AND p.deleted_at IS NULL
   AND p.merged_into IS NULL
   AND p.due_date IS NULL
   AND p.date_status IS NULL
   AND p.due_raw IS NOT NULL
   AND btrim(p.due_raw) <> ''
   AND ($1::uuid IS NULL OR p.user_id = $1)
 ORDER BY p.user_id, p.created_at`;

/** Read-only: model-proposed, untimed, never-asked meetings with a phrase; flags a rep edit; $1 = --only-user. */
export const MEETING_UNDATED_SQL = `
SELECT mt.id, mt.user_id, mt.datetime_raw, mt.date_status, mt.confirmed, mt.source_message_at, mt.capture_at, mt.created_at,
       cl.name AS client_name,
       COALESCE(u.timezone, 'Asia/Dubai') AS timezone,
       (n.source = 'whatsapp_export') AS day_first,
       EXISTS (SELECT 1 FROM corrections c
                WHERE c.entity_type = 'meeting' AND c.entity_id = mt.id AND c.field = 'datetime') AS rep_edited
  FROM meetings mt
  JOIN users u ON u.id = mt.user_id
  LEFT JOIN notes n ON n.id = mt.note_id
  LEFT JOIN clients cl ON cl.id = mt.client_id
 WHERE mt.note_id IS NOT NULL
   AND mt.datetime IS NULL
   AND mt.date_status IS NULL
   AND btrim(mt.datetime_raw) <> ''
   AND ($1::uuid IS NULL OR mt.user_id = $1)
 ORDER BY mt.user_id, mt.created_at`;

/** The only writes: the question flag, guarded on the row still being undated and unanswered. */
export const PROMISE_MARK_SQL = "UPDATE promises SET date_status = 'to_confirm' WHERE id = $1 AND due_date IS NULL AND date_status IS NULL";
export const MEETING_MARK_SQL = "UPDATE meetings SET date_status = 'to_confirm' WHERE id = $1 AND datetime IS NULL AND date_status IS NULL";

function anchorOf(sourceMessageAt: Date | null, captureAt: string | null, createdAt: Date): string {
  return sourceMessageAt ? sourceMessageAt.toISOString() : captureAt ?? createdAt.toISOString();
}

async function main(): Promise<void> {
  const { apply, onlyUser } = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    type P = { id: string; user_id: string; due_raw: string; date_status: string | null; source_message_at: Date | null; capture_at: string | null; created_at: Date; client_name: string | null; day_first: boolean | null; rep_edited: boolean };
    type M = { id: string; user_id: string; datetime_raw: string; date_status: string | null; confirmed: boolean; source_message_at: Date | null; capture_at: string | null; created_at: Date; client_name: string | null; timezone: string; day_first: boolean | null; rep_edited: boolean };
    const [{ rows: pr }, { rows: mr }] = await Promise.all([pool.query<P>(PROMISE_UNDATED_SQL, [onlyUser]), pool.query<M>(MEETING_UNDATED_SQL, [onlyUser])]);
    const plan = planUndatedToConfirm({
      promises: pr.map((r) => ({ id: r.id, userId: r.user_id, clientName: r.client_name, dueRaw: r.due_raw, anchor: anchorOf(r.source_message_at, r.capture_at, r.created_at), dayFirst: r.day_first === true, repEdited: r.rep_edited, dateStatus: r.date_status })),
      meetings: mr.map((r) => ({ id: r.id, userId: r.user_id, clientName: r.client_name, datetimeRaw: r.datetime_raw, anchor: anchorOf(r.source_message_at, r.capture_at, r.created_at), dayFirst: r.day_first === true, timezone: r.timezone, repEdited: r.rep_edited, confirmed: r.confirmed, dateStatus: r.date_status })),
    }, Date.now());

    const scope = onlyUser ? `user ${onlyUser}` : 'all users';
    console.log(`[undated-to-confirm] ${pr.length} undated open promise(s), ${mr.length} untimed meeting(s), never asked (${scope}).`);
    console.log(`[undated-to-confirm] PROMISES → date to confirm, no date set (${plan.promises.length}):`);
    for (const t of plan.promises) console.log(`  ${formatMark('promise', t)}`);
    console.log(`[undated-to-confirm] MEETINGS → date to confirm, no time set (${plan.meetings.length}):`);
    for (const t of plan.meetings) console.log(`  ${formatMark('meeting', t)}`);
    console.log(`[undated-to-confirm] RESOLVABLE — left to promise-dates / meeting-dates (${plan.resolvable.length}):`);
    for (const r of plan.resolvable) console.log(`  ~ ${r.kind} ${r.id}  "${r.raw}"`);
    console.log(`[undated-to-confirm] SKIPPED — the rep already acted (${plan.skipped.length}):`);
    for (const r of plan.skipped) console.log(`  = ${r.kind} ${r.id}  "${r.raw}"  (${r.why})`);

    if (!apply) {
      console.log('[undated-to-confirm] DRY RUN — no writes. Re-run with --apply to mark the rows above.');
      return;
    }
    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const t of plan.promises) updated += ((await client.query(PROMISE_MARK_SQL, [t.id])) as { rowCount: number }).rowCount ?? 0;
      for (const t of plan.meetings) updated += ((await client.query(MEETING_MARK_SQL, [t.id])) as { rowCount: number }).rowCount ?? 0;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`[undated-to-confirm] marked ${updated} of ${plan.promises.length + plan.meetings.length} row(s).`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('[undated-to-confirm] failed:', err);
    process.exit(1);
  });
}
