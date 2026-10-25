import { describe, it, expect } from 'vitest';
import { planPromiseRedate, formatToConfirm, formatRepEdited, PROMISE_CANDIDATES_SQL, PROMISE_TO_CONFIRM_SQL } from './backfill-promise-dates.js';

/**
 * [P40-1] The dry run also lists stored rows whose date came from the model with no resolver match: id, client, raw
 * phrase, stored date, receipt date and the action (null + date to confirm). A rep-edited date is never touched;
 * a stored date the receipt quote itself states explicitly (and the resolver reads the same) is kept.
 */
const row = (o: Record<string, unknown>) => ({ id: 'p1', userId: 'u1', clientName: 'Sara Khan', dueRaw: 'soon', dueDate: '2026-10-20', anchor: '2026-10-10T10:05', dayFirst: true, repEdited: false, sourceSpan: "I'll send them soon", ...o });

describe('[P40-1] promise-dates dry run: model dates with no resolver match', () => {
  it('a stored date the resolver can\'t reproduce → listed: null + date to confirm', () => {
    const plan = planPromiseRedate([row({})]);
    expect(plan.toConfirm).toEqual([{ id: 'p1', userId: 'u1', client: 'Sara Khan', dueRaw: 'soon', from: '2026-10-20', receiptDate: '2026-10-10' }]);
    expect(plan.changes).toEqual([]);
    expect(formatToConfirm(plan.toConfirm[0]!)).toBe('? p1  Sara Khan  "soon"  stored 2026-10-20  said 2026-10-10  → null + date to confirm');
  });

  it('a resolvable phrase is a re-date, not a to-confirm (the P39 row: 20 Oct → 11 Oct)', () => {
    const plan = planPromiseRedate([row({ dueRaw: 'Sunday morning' })]);
    expect(plan.changes.map((c) => c.to)).toEqual(['2026-10-11']);
    expect(plan.toConfirm).toEqual([]);
  });

  it('negative: a rep-edited date is never touched', () => {
    const plan = planPromiseRedate([row({ repEdited: true })]);
    expect(plan.toConfirm).toEqual([]);
    expect(plan.skippedRepEdited.map((r) => r.id)).toEqual(['p1']);
  });

  it('negative: an explicit date in the receipt that matches the stored date is kept', () => {
    const plan = planPromiseRedate([row({ dueRaw: 'by the 25th', dueDate: '2026-10-25', sourceSpan: 'payment on 25/10/2026' })]);
    expect(plan.toConfirm).toEqual([]);
  });

  it('negative: an undated row with an unreadable phrase is left alone (nothing guessed, nothing to null)', () => {
    const plan = planPromiseRedate([row({ dueDate: null })]);
    expect(plan.toConfirm).toEqual([]);
    expect(plan.unresolved.map((r) => r.id)).toEqual(['p1']);
  });

  it('the SQL reads the client and the receipt, and the write is guarded on the value read', () => {
    expect(PROMISE_CANDIDATES_SQL).toMatch(/client_name/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/source_span/);
    expect(PROMISE_TO_CONFIRM_SQL).toBe("UPDATE promises SET due_date = NULL, date_status = 'to_confirm' WHERE id = $1 AND due_date IS NOT DISTINCT FROM $2::date");
  });
});

// [P43-1] "Why is f700fab8 rep-edited?" — the dry run shows the edit behind every rep-edited skip (metadata only:
// which field, the verdict, the kind, the day shift and when; the corrections table holds no before/after values).
describe('[P43-1] the dry run shows why a row counts as rep-edited', () => {
  it('lists each edit: field, verdict, kind, day shift and when', () => {
    const plan = planPromiseRedate([row({ id: 'f700fab8', dueRaw: 'Sunday morning', repEdited: true, edits: [{ field: 'due_date', verdict: 'edit', kind: 'date_wrong', deltaDays: -9, at: '2026-10-21T14:03:00.000Z' }] })]);
    expect(plan.skippedRepEdited).toEqual([{ id: 'f700fab8', dueRaw: 'Sunday morning', edits: [{ field: 'due_date', verdict: 'edit', kind: 'date_wrong', deltaDays: -9, at: '2026-10-21T14:03:00.000Z' }] }]);
    expect(formatRepEdited(plan.skippedRepEdited[0]!)).toBe('= f700fab8  "Sunday morning"  rep edit: due_date edit (date_wrong, -9 days) on 2026-10-21 14:03 UTC');
  });
  it('the candidates read the edits (metadata only) alongside the flag', () => {
    expect(PROMISE_CANDIDATES_SQL).toMatch(/json_agg/);
    expect(PROMISE_CANDIDATES_SQL).toMatch(/date_delta_days/);
    expect(PROMISE_CANDIDATES_SQL).not.toMatch(/before_value|after_value/);
  });
});
