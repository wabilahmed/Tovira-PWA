import { describe, it, expect } from 'vitest';
import {
  planUndatedToConfirm, formatMark, PROMISE_UNDATED_SQL, MEETING_UNDATED_SQL, PROMISE_MARK_SQL, MEETING_MARK_SQL,
  type UndatedPromiseRow, type UndatedMeetingRow,
} from './backfill-undated-to-confirm.js';

/**
 * [P43 · owner] Open promises and meetings stored before migrations 0093/0094 with no date ("before you travel",
 * "next week", "the 5th", a meeting on "Saturday" with no time) were never asked "When is it due?". This dry-run-first
 * backfill marks them date to confirm, so they get the question card (cards only within the 90-day rule; older ones
 * keep the label). It NEVER writes a date. A phrase the resolver CAN read is left to promise-dates / meeting-dates.
 */
const NOW = Date.parse('2026-10-25T09:00:00Z');
const p = (o: Partial<UndatedPromiseRow> = {}): UndatedPromiseRow => ({ id: 'p1', userId: 'u1', clientName: 'Sara Khan', dueRaw: 'before you travel', anchor: '2026-10-10T10:05', dayFirst: true, repEdited: false, dateStatus: null, ...o });
const m = (o: Partial<UndatedMeetingRow> = {}): UndatedMeetingRow => ({ id: 'm1', userId: 'u1', clientName: 'Omar Ali', datetimeRaw: 'Saturday', anchor: '2026-10-21T10:00', dayFirst: true, timezone: 'Asia/Dubai', repEdited: false, confirmed: false, dateStatus: null, ...o });

describe('[P43] undated-to-confirm: undated, never-asked rows get the question', () => {
  it('unreadable promise phrases are marked, with no date', () => {
    const plan = planUndatedToConfirm({ promises: [p(), p({ id: 'p2', dueRaw: 'next week' }), p({ id: 'p3', dueRaw: 'the 5th' }), p({ id: 'p4', dueRaw: 'next Tuesday' })], meetings: [] }, NOW);
    expect(plan.promises.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(plan.promises[0]).toEqual({ id: 'p1', userId: 'u1', client: 'Sara Khan', raw: 'before you travel', said: '2026-10-10', card: true });
  });

  it('a meeting on "Saturday" with no clock time is marked (a meeting needs a time; none is guessed)', () => {
    const plan = planUndatedToConfirm({ promises: [], meetings: [m()] }, NOW);
    expect(plan.meetings.map((x) => x.id)).toEqual(['m1']);
  });

  it('a phrase the resolver CAN read is not marked: it is listed for promise-dates / meeting-dates', () => {
    const plan = planUndatedToConfirm({ promises: [p({ dueRaw: 'Sunday morning' })], meetings: [m({ datetimeRaw: 'Saturday at 3pm' })] }, NOW);
    expect(plan.promises).toEqual([]);
    expect(plan.meetings).toEqual([]);
    expect(plan.resolvable.map((r) => `${r.kind}:${r.id}`)).toEqual(['promise:p1', 'meeting:m1']);
  });

  it('older than 90 days: still marked, but says "label only" (no card)', () => {
    const plan = planUndatedToConfirm({ promises: [p({ anchor: '2026-06-01T09:00' })], meetings: [] }, NOW);
    expect(plan.promises[0]!.card).toBe(false);
    expect(formatMark('promise', plan.promises[0]!)).toBe('? p1  Sara Khan  "before you travel"  said 2026-06-01  → date to confirm (label only, older than 90 days)');
  });

  it('the dry-run line', () => {
    const plan = planUndatedToConfirm({ promises: [p()], meetings: [] }, NOW);
    expect(formatMark('promise', plan.promises[0]!)).toBe('? p1  Sara Khan  "before you travel"  said 2026-10-10  → date to confirm (card)');
  });

  it('NEGATIVE: a rep-edited row, an answered or already-waiting row, and a rep-confirmed meeting are never marked', () => {
    const plan = planUndatedToConfirm({
      promises: [p({ id: 'edited', repEdited: true }), p({ id: 'not-sure', dateStatus: 'not_sure' }), p({ id: 'no-date', dateStatus: 'no_due_date' }), p({ id: 'waiting', dateStatus: 'to_confirm' })],
      meetings: [m({ id: 'confirmed', confirmed: true }), m({ id: 'medited', repEdited: true }), m({ id: 'mno', dateStatus: 'no_date' })],
    }, NOW);
    expect(plan.promises).toEqual([]);
    expect(plan.meetings).toEqual([]);
    expect(plan.skipped.map((s) => s.id).sort()).toEqual(['confirmed', 'edited', 'medited']);
  });

  it('NEGATIVE: the writes set only date_status, only on a row that is still undated and unanswered', () => {
    expect(PROMISE_MARK_SQL).toBe("UPDATE promises SET date_status = 'to_confirm' WHERE id = $1 AND due_date IS NULL AND date_status IS NULL");
    expect(MEETING_MARK_SQL).toBe("UPDATE meetings SET date_status = 'to_confirm' WHERE id = $1 AND datetime IS NULL AND date_status IS NULL");
    expect(`${PROMISE_MARK_SQL} ${MEETING_MARK_SQL}`).not.toMatch(/due_date =|datetime =/);
  });

  it('the candidates are open, live, undated, unanswered rows with a phrase, flagging rep edits', () => {
    for (const sql of [PROMISE_UNDATED_SQL, MEETING_UNDATED_SQL]) expect(sql).toMatch(/date_status IS NULL/);
    expect(PROMISE_UNDATED_SQL).toMatch(/p\.due_date IS NULL/);
    expect(PROMISE_UNDATED_SQL).toMatch(/p\.done = false/);
    expect(PROMISE_UNDATED_SQL).toMatch(/p\.deleted_at IS NULL/);
    expect(PROMISE_UNDATED_SQL).toMatch(/c\.field IN \('due_date', 'due_raw'\)/);
    expect(MEETING_UNDATED_SQL).toMatch(/mt\.datetime IS NULL/);
    expect(MEETING_UNDATED_SQL).toMatch(/mt\.note_id IS NOT NULL/);
    expect(MEETING_UNDATED_SQL).toMatch(/c\.field = 'datetime'/);
  });
});
