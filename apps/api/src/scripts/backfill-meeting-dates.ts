/**
 * [P21-C] One-off, idempotent backfill: RE-DATE model-proposed meetings with the same deterministic
 * resolver extraction now uses (P18-3: the date phrase anchored to the meeting's own message + an explicit
 * clock time, in the chat's day-first order), converted to an instant in the REP's timezone exactly as
 * extraction does (zonedWallClockToInstant). Fixes meetings stored before that wiring — e.g.
 * "12/04/2026 at 3pm" in a day-first chat landing on 4 Dec, or with no time at all.
 *
 * Rules (same as backfill-promise-dates):
 *   - Model-proposed meetings only (note_id set). A meeting the rep created is never touched.
 *   - NEVER overwrites a rep-edited time: a meeting with a 'datetime' edit in corrections is skipped (and
 *     listed). A rep-CONFIRMED meeting is not an edit, but its line is flagged "(rep-confirmed)".
 *   - NEVER touches the model's own fields: notes.extracted (the model's datetime) and datetime_raw are
 *     not written; only meetings.datetime changes.
 *   - NEVER guesses: a phrase without a resolvable date AND clock time leaves the stored value as it is.
 *   - IDEMPOTENT: an already-correct instant is not a change; the write is guarded on the value it read.
 * Dry run prints one line per change: id, raw phrase, old → new. `--only-user <uuid>` scopes to one rep.
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-meeting-dates.ts [--only-user <uuid>]
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/backfill-meeting-dates.ts [--only-user <uuid>] --apply
 *   In prod:  scripts/ops/run-backfill.sh --script meeting-dates [--only-user <uuid>] [--apply]
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { resolveDateTime } from '../services/extraction/resolve-date.js';
import { zonedWallClockToInstant } from '../services/time/zone.js';
import { formatMessageStamp } from '../services/text/format-date.js';
import { parseBackfillArgs } from './backfill-promise-dates.js';
import { trustedMeetingDatetime } from '../services/extraction/date-policy.js';

export interface MeetingRedateRow {
  id: string;
  userId: string;
  datetimeRaw: string;
  /** The stored instant (ISO, UTC) or null. */
  datetime: string | null;
  /** source_message_at, else the conversation date (capture_at), else created_at. */
  anchor: string;
  dayFirst: boolean;
  /** The rep's IANA timezone (users.timezone). */
  timezone: string;
  repEdited: boolean;
  confirmed: boolean;
  /** [P40-1] for the to-confirm list: the client's name and the stored receipt quote. */
  clientName?: string | null;
  sourceSpan?: string | null;
}

/** [P40-1] A stored meeting time that came from the model with no resolver match → null + date to confirm. */
export interface MeetingToConfirm { id: string; userId: string; client: string; datetimeRaw: string; from: string; receiptDate: string | null }

export interface MeetingChange { id: string; userId: string; datetimeRaw: string; from: string | null; to: string; wall: string; timezone: string; confirmed: boolean }

export interface MeetingRedatePlan {
  changes: MeetingChange[];
  /** [P40-1] model times the resolver can't reproduce (and the receipt doesn't state) → null + date to confirm. */
  toConfirm: MeetingToConfirm[];
  unresolved: Array<{ id: string; datetimeRaw: string }>;
  skippedRepEdited: Array<{ id: string; datetimeRaw: string }>;
}

/** PURE re-date decision (unit-tested with the real resolver + zone conversion). */
export function planMeetingRedate(rows: MeetingRedateRow[]): MeetingRedatePlan {
  const plan: MeetingRedatePlan = { changes: [], toConfirm: [], unresolved: [], skippedRepEdited: [] };
  for (const r of rows) {
    if (r.repEdited) { plan.skippedRepEdited.push({ id: r.id, datetimeRaw: r.datetimeRaw }); continue; }
    const wall = resolveDateTime(r.datetimeRaw, r.anchor, { dayFirst: r.dayFirst }).datetime;
    let to: string | null = null;
    if (wall) { try { to = zonedWallClockToInstant(wall, r.timezone).toISOString(); } catch { to = null; } }
    if (!wall || !to) {
      // [P40-1] A stored time here came from the model. Unless the rep confirmed it (they accepted that time) or the
      // receipt itself states it, it becomes null + date to confirm. An untimed meeting is left alone.
      const storedWall = r.datetime ? wallClockIn(r.datetime, r.timezone) : null;
      const stated = storedWall !== null && trustedMeetingDatetime(
        { datetime: storedWall, datetime_raw: r.datetimeRaw, confirmed: false, resolved_datetime: null, source_span: r.sourceSpan ?? null },
        { dayFirst: r.dayFirst },
      ) === storedWall;
      if (r.datetime !== null && !r.confirmed && !stated) {
        plan.toConfirm.push({ id: r.id, userId: r.userId, client: r.clientName ?? '', datetimeRaw: r.datetimeRaw, from: r.datetime, receiptDate: /^\d{4}-\d{2}-\d{2}/.exec(r.anchor)?.[0] ?? null });
      } else plan.unresolved.push({ id: r.id, datetimeRaw: r.datetimeRaw });
      continue;
    }
    if (r.datetime !== null && Date.parse(r.datetime) === Date.parse(to)) continue; // already right
    plan.changes.push({ id: r.id, userId: r.userId, datetimeRaw: r.datetimeRaw, from: r.datetime, to, wall, timezone: r.timezone, confirmed: r.confirmed });
  }
  return plan;
}

/** "2026-10-10T11:00:00.000Z" in Asia/Dubai → "2026-10-10T15:00" (the rep's wall clock). */
function wallClockIn(instant: string, timezone: string): string | null {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return null;
  }
}

/** [P40-1] The dry-run line for a to-confirm meeting, in the promise-dates format. */
export function formatMeetingToConfirm(t: MeetingToConfirm): string {
  return `? ${t.id}  ${t.client}  "${t.datetimeRaw}"  stored ${t.from}  said ${t.receiptDate ?? '(unknown)'}  → null + date to confirm`;
}

/** The dry-run line: id, raw phrase, old → new (as the rep will see it, plus the stored instant). */
export function formatMeetingChange(c: MeetingChange): string {
  return `~ ${c.id}  "${c.datetimeRaw}"  ${c.from ?? '(none)'} → ${formatMessageStamp(c.wall)} ${c.timezone} (${c.to})${c.confirmed ? '  (rep-confirmed)' : ''}`;
}

/** Read-only candidates: model-proposed meetings with a phrase; flags a rep edit of the time; $1 =
 *  --only-user (NULL = every rep). */
export const MEETING_CANDIDATES_SQL = `
SELECT mt.id, mt.user_id, mt.datetime_raw, mt.datetime, mt.source_message_at, mt.capture_at, mt.created_at, mt.confirmed,
       mt.source_span, cl.name AS client_name,
       COALESCE(u.timezone, 'Asia/Dubai') AS timezone,
       (n.source = 'whatsapp_export') AS day_first,
       EXISTS (SELECT 1 FROM corrections c
                WHERE c.entity_type = 'meeting' AND c.entity_id = mt.id AND c.field = 'datetime') AS rep_edited
  FROM meetings mt
  JOIN users u ON u.id = mt.user_id
  LEFT JOIN notes n ON n.id = mt.note_id
  LEFT JOIN clients cl ON cl.id = mt.client_id
 WHERE mt.note_id IS NOT NULL
   AND btrim(mt.datetime_raw) <> ''
   AND ($1::uuid IS NULL OR mt.user_id = $1)
 ORDER BY mt.user_id, mt.created_at`;

/** The only write: the meeting instant, guarded on the value the dry run read. */
export const MEETING_UPDATE_SQL = 'UPDATE meetings SET datetime = $2 WHERE id = $1 AND datetime IS NOT DISTINCT FROM $3::timestamptz';
/** [P40-1] A model time with no resolver match: null + date to confirm, guarded on the value the dry run read. */
export const MEETING_TO_CONFIRM_SQL = "UPDATE meetings SET datetime = NULL, date_status = 'to_confirm' WHERE id = $1 AND datetime IS NOT DISTINCT FROM $2::timestamptz";

async function main(): Promise<void> {
  const { apply, onlyUser } = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }

  // [P17-SSL] Same pool factory the API uses (TLS for RDS, plain locally) — never a raw new pg.Pool.
  const pool = createPool(url);
  try {
    const { rows } = await pool.query<{ id: string; user_id: string; datetime_raw: string; datetime: Date | null; source_message_at: Date | null; capture_at: string | null; created_at: Date; confirmed: boolean; timezone: string; day_first: boolean | null; rep_edited: boolean; source_span: string | null; client_name: string | null }>(MEETING_CANDIDATES_SQL, [onlyUser]);
    const plan = planMeetingRedate(rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      datetimeRaw: r.datetime_raw,
      datetime: r.datetime ? r.datetime.toISOString() : null,
      anchor: r.source_message_at ? r.source_message_at.toISOString() : r.capture_at ?? r.created_at.toISOString(),
      dayFirst: r.day_first === true,
      timezone: r.timezone,
      repEdited: r.rep_edited,
      confirmed: r.confirmed,
      clientName: r.client_name,
      sourceSpan: r.source_span,
    })));

    const scope = onlyUser ? `user ${onlyUser}` : 'all users';
    console.log(`[backfill-meeting-dates] ${rows.length} model-proposed meeting(s) (${scope}).`);
    console.log(`[backfill-meeting-dates] CHANGES (${plan.changes.length}):`);
    for (const c of plan.changes) console.log(`  ${formatMeetingChange(c)}`);
    console.log(`[backfill-meeting-dates] MODEL TIME, NO RESOLVER MATCH → null + date to confirm (${plan.toConfirm.length}):`);
    for (const t of plan.toConfirm) console.log(`  ${formatMeetingToConfirm(t)}`);
    console.log(`[backfill-meeting-dates] SKIPPED — rep-edited (${plan.skippedRepEdited.length}):`);
    for (const r of plan.skippedRepEdited) console.log(`  = ${r.id}  "${r.datetimeRaw}"`);
    console.log(`[backfill-meeting-dates] UNRESOLVED — left as stored, never guessed (${plan.unresolved.length}):`);
    for (const r of plan.unresolved) console.log(`  - ${r.id}  "${r.datetimeRaw}"`);

    if (!apply) {
      console.log('[backfill-meeting-dates] DRY RUN — no writes. Re-run with --apply to write the changes above.');
      return;
    }

    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const c of plan.changes) {
        const res = await client.query(MEETING_UPDATE_SQL, [c.id, c.to, c.from]);
        updated += (res as { rowCount: number }).rowCount ?? 0;
      }
      for (const t of plan.toConfirm) {
        const res = await client.query(MEETING_TO_CONFIRM_SQL, [t.id, t.from]);
        updated += (res as { rowCount: number }).rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`[backfill-meeting-dates] updated ${updated} of ${plan.changes.length + plan.toConfirm.length} planned change(s).`);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[backfill-meeting-dates] failed', e); process.exit(1); });
}
