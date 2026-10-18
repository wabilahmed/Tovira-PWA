import { describe, it, expect } from 'vitest';
import { planPromiseRedate, formatPromiseChange, PROMISE_CANDIDATES_SQL, PROMISE_UPDATE_SQL, parseBackfillArgs, type PromiseRedateRow } from './backfill-promise-dates.js';
import { planMeetingRedate, formatMeetingChange, MEETING_CANDIDATES_SQL, MEETING_UPDATE_SQL, type MeetingRedateRow } from './backfill-meeting-dates.js';

/**
 * [P21-C] Re-date stored promises and meetings with the P14/P18 resolver (message-anchored, strictly-after
 * weekdays, the chat's day-first order). Rules: never overwrite a rep-edited value; never touch the model's
 * own fields (notes.extracted is not written — only the fact rows' surfaced date); idempotent; a dry run
 * prints one line per change (id, raw phrase, new value); --only-user scopes to one rep.
 * The rows below are the 18 Oct test rep's expected changes.
 */
const p = (over: Partial<PromiseRedateRow>): PromiseRedateRow => ({
  id: 'p', userId: 'U', dueRaw: 'Monday', dueDate: null, anchor: '2026-04-20T09:00:00.000Z', dayFirst: true, repEdited: false, ...over,
});

describe('[P21-C] planPromiseRedate', () => {
  it('the test rep\'s promises re-date as expected', () => {
    const plan = planPromiseRedate([
      p({ id: 'ahmed-monday', dueRaw: 'Monday', dueDate: '2026-04-20', anchor: '2026-04-20T09:00:00.000Z' }), // said on Mon 20 Apr
      p({ id: 'sara-2003', dueRaw: '20/03/2026', dueDate: null, anchor: '2026-03-10T08:00:00.000Z' }),
      p({ id: 'ahmed-thursday', dueRaw: 'Thursday', dueDate: null, anchor: '2026-03-02T10:00:00.000Z' }),
    ]);
    expect(plan.changes.map((c) => [c.id, c.from, c.to])).toEqual([
      ['ahmed-monday', '2026-04-20', '2026-04-27'],
      ['sara-2003', null, '2026-03-20'],
      ['ahmed-thursday', null, '2026-03-05'],
    ]);
  });

  it('NEGATIVE: never overwrites a rep-edited date', () => {
    const plan = planPromiseRedate([p({ id: 'edited', dueDate: '2026-04-20', repEdited: true })]);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skippedRepEdited.map((s) => s.id)).toEqual(['edited']);
  });

  it('is idempotent: an already-correct date is not a change', () => {
    expect(planPromiseRedate([p({ dueDate: '2026-04-27' })]).changes).toHaveLength(0);
  });

  it('NEGATIVE: never guesses — an unresolvable phrase leaves the stored date alone', () => {
    const plan = planPromiseRedate([p({ id: 'vague', dueRaw: 'next week', dueDate: '2026-04-24' }), p({ id: 'ambig', dueRaw: '12/04/2026', dueDate: null, dayFirst: false })]);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unresolved.map((u) => u.id)).toEqual(['vague', 'ambig']);
  });

  it('NEGATIVE: never sets a promise due BEFORE the message that made it', () => {
    const plan = planPromiseRedate([p({ id: 'past', dueRaw: '01/01/2026', dueDate: null, anchor: '2026-03-02T10:00:00.000Z' })]);
    expect(plan.changes).toHaveLength(0);
  });

  it('dry-run line: id, raw phrase, old → new', () => {
    expect(formatPromiseChange({ id: 'ahmed-monday', userId: 'U', dueRaw: 'Monday', from: '2026-04-20', to: '2026-04-27' }))
      .toBe('~ ahmed-monday  "Monday"  2026-04-20 → 2026-04-27');
    expect(formatPromiseChange({ id: 'x', userId: 'U', dueRaw: 'Thursday', from: null, to: '2026-03-05' }))
      .toBe('~ x  "Thursday"  (none) → 2026-03-05');
  });

  it('SQL: open, live, canonical promises with a phrase; rep edits excluded; --only-user is a bound parameter', () => {
    expect(PROMISE_CANDIDATES_SQL).toMatch(/done = false/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/deleted_at IS NULL/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/merged_into IS NULL/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/\$1::uuid IS NULL OR p\.user_id = \$1/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/entity_type = 'promise'/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/field IN \('due_date', 'due_raw'\)/);
    // Found against a live Postgres: a `date` read as a JS Date is local midnight, so off-UTC it reads a
    // day early and every row looks "changed". The day is read as text — no timezone in the path.
    expect(PROMISE_CANDIDATES_SQL).toMatch(/p\.due_date::text AS due_date/);
  });

  it('SQL: the write touches ONLY promises.due_date, guarded on the value it read (no clobber, no model fields)', () => {
    expect(PROMISE_UPDATE_SQL).toMatch(/^UPDATE promises SET due_date = \$2 WHERE id = \$1 AND due_date IS NOT DISTINCT FROM \$3/);
    expect(PROMISE_UPDATE_SQL).not.toMatch(/notes|extracted|due_raw/);
  });
});

const m = (over: Partial<MeetingRedateRow>): MeetingRedateRow => ({
  id: 'm', userId: 'U', datetimeRaw: '12/04/2026 at 3pm', datetime: null, anchor: '2026-04-01T09:00:00.000Z', dayFirst: true, timezone: 'Asia/Dubai', repEdited: false, confirmed: false, ...over,
});

describe('[P21-C] planMeetingRedate', () => {
  it('Sara and Gate "12/04/2026 at 3pm" → 12 Apr 15:00 in the rep\'s zone', () => {
    const plan = planMeetingRedate([m({ id: 'sara-mtg' }), m({ id: 'gate-mtg', datetime: '2026-12-04T11:00:00.000Z' })]);
    expect(plan.changes.map((c) => [c.id, c.to])).toEqual([['sara-mtg', '2026-04-12T11:00:00.000Z'], ['gate-mtg', '2026-04-12T11:00:00.000Z']]);
    expect(formatMeetingChange(plan.changes[1]!)).toBe('~ gate-mtg  "12/04/2026 at 3pm"  2026-12-04T11:00:00.000Z → 12 Apr 2026, 15:00 Asia/Dubai (2026-04-12T11:00:00.000Z)');
  });

  it('NEGATIVE: never overwrites a rep-edited meeting time; idempotent; never guesses', () => {
    const plan = planMeetingRedate([
      m({ id: 'edited', repEdited: true }),
      m({ id: 'same', datetime: '2026-04-12T11:00:00.000Z' }),
      m({ id: 'ambig', dayFirst: false }),
      m({ id: 'no-time', datetimeRaw: '12/04/2026' }),
    ]);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skippedRepEdited.map((s) => s.id)).toEqual(['edited']);
    expect(plan.unresolved.map((u) => u.id)).toEqual(['ambig', 'no-time']);
  });

  it('a rep-confirmed meeting is changed only visibly — flagged in the dry-run line', () => {
    const plan = planMeetingRedate([m({ id: 'conf', confirmed: true })]);
    expect(formatMeetingChange(plan.changes[0]!)).toMatch(/\(rep-confirmed\)$/);
  });

  it('SQL: model-proposed meetings only (note_id set), rep edits excluded, --only-user bound; write touches only meetings.datetime', () => {
    expect(MEETING_CANDIDATES_SQL).toMatch(/note_id IS NOT NULL/);
    expect(MEETING_CANDIDATES_SQL).toMatch(/entity_type = 'meeting'/);
    expect(MEETING_CANDIDATES_SQL).toMatch(/field = 'datetime'/);
    expect(MEETING_CANDIDATES_SQL).toMatch(/\$1::uuid IS NULL OR mt\.user_id = \$1/);
    expect(MEETING_UPDATE_SQL).toMatch(/^UPDATE meetings SET datetime = \$2 WHERE id = \$1 AND datetime IS NOT DISTINCT FROM \$3/);
    expect(MEETING_UPDATE_SQL).not.toMatch(/notes|extracted|datetime_raw/);
  });
});

describe('[P21-C] CLI args', () => {
  it('dry run by default; --apply writes; --only-user scopes', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false, onlyUser: null });
    expect(parseBackfillArgs(['--only-user', '8747fb0a-d7c5-48e0-9732-cf524c47b5bb', '--apply'])).toEqual({ apply: true, onlyUser: '8747fb0a-d7c5-48e0-9732-cf524c47b5bb' });
    expect(() => parseBackfillArgs(['--only-user'])).toThrow(/needs a user id/);
    expect(() => parseBackfillArgs(['--only-user', 'not-a-uuid'])).toThrow(/uuid/);
    expect(() => parseBackfillArgs(['--bogus'])).toThrow(/unknown/);
  });
});
