import { describe, it, expect } from 'vitest';
import { planMeetingRedate, formatMeetingToConfirm, MEETING_CANDIDATES_SQL, MEETING_TO_CONFIRM_SQL } from './backfill-meeting-dates.js';

/**
 * [P40-1 · owner] The meeting-dates dry run also lists stored meeting times that came from the model with no resolver
 * match, in the promise-dates format: id, client, phrase, stored time, the date it was said, and the action (null +
 * date to confirm). Rep-edited and rep-confirmed meetings are never touched; a time the receipt states explicitly
 * (and the resolver reads the same) is kept.
 */
const row = (o: Record<string, unknown>) => ({ id: 'm1', userId: 'u1', clientName: 'Sara Khan', datetimeRaw: 'Saturday afternoon', datetime: '2026-10-10T11:00:00.000Z', anchor: '2026-10-08T10:00', dayFirst: true, timezone: 'Asia/Dubai', repEdited: false, confirmed: false, sourceSpan: 'see you Saturday afternoon', ...o });

describe('[P40-1] meeting-dates dry run: model times with no resolver match', () => {
  it('listed: null + date to confirm, in the promise-dates format', () => {
    const plan = planMeetingRedate([row({})]);
    expect(plan.toConfirm).toEqual([{ id: 'm1', userId: 'u1', client: 'Sara Khan', datetimeRaw: 'Saturday afternoon', from: '2026-10-10T11:00:00.000Z', receiptDate: '2026-10-08' }]);
    expect(formatMeetingToConfirm(plan.toConfirm[0]!)).toBe('? m1  Sara Khan  "Saturday afternoon"  stored 2026-10-10T11:00:00.000Z  said 2026-10-08  → null + date to confirm');
  });

  it('negative: rep-edited or rep-confirmed meetings are never touched', () => {
    const plan = planMeetingRedate([row({ repEdited: true }), row({ id: 'm2', confirmed: true })]);
    expect(plan.toConfirm).toEqual([]);
  });

  it('negative: a time the receipt states ("10/10/2026 at 3pm") and the resolver reads the same is kept', () => {
    const plan = planMeetingRedate([row({ datetimeRaw: 'then', sourceSpan: 'see you 10/10/2026 at 3pm', datetime: '2026-10-10T11:00:00.000Z' })]);
    expect(plan.toConfirm).toEqual([]);
  });

  it('a resolvable phrase is a re-date, not a to-confirm', () => {
    const plan = planMeetingRedate([row({ datetimeRaw: 'Saturday 3pm', datetime: '2026-10-17T11:00:00.000Z' })]);
    expect(plan.changes.map((c) => c.wall)).toEqual(['2026-10-10T15:00']);
    expect(plan.toConfirm).toEqual([]);
  });

  it('the SQL reads the client and the receipt; the write is guarded on the value read', () => {
    expect(MEETING_CANDIDATES_SQL).toMatch(/client_name/);
    expect(MEETING_CANDIDATES_SQL).toMatch(/source_span/);
    expect(MEETING_TO_CONFIRM_SQL).toBe("UPDATE meetings SET datetime = NULL, date_status = 'to_confirm' WHERE id = $1 AND datetime IS NOT DISTINCT FROM $2::timestamptz");
  });
});
