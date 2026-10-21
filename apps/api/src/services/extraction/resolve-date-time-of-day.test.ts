import { describe, it, expect } from 'vitest';
import { resolveDueDate, resolveExtractionDates, effectiveDueDate } from './resolve-date.js';
import type { ExtractedPromise } from './types.js';

/**
 * [P39-5] The live Today entry "Send the floor plans" showed due 20 Oct 2026. Its receipt: the rep, Saturday
 * 10 Oct 2026 10:05, "Sure, I'll send them Sunday morning" → Sunday 11 Oct. Root cause: the resolver only knew a
 * BARE weekday, so "Sunday morning" resolved to null and surfacing fell back to the model's own due_date (20 Oct).
 * A trailing time-of-day word (morning / afternoon / evening / night / noon / EOD) names a part of that day,
 * never a different day, so it is dropped before resolving. Everything that was refused stays refused.
 */
const SAT_1005 = '2026-10-10T10:05';

describe('[P39-5] a weekday with a time of day resolves to that weekday', () => {
  it('the exact receipt: "Sunday morning" said Saturday 10 Oct → Sunday 11 Oct', () => {
    expect(resolveDueDate('Sunday morning', SAT_1005)).toEqual({ date: '2026-10-11', resolution: 'relative' });
  });

  it.each([
    ['sunday morning', '2026-10-11'],
    ['by Sunday morning', '2026-10-11'],
    ['this Sunday morning', '2026-10-11'],
    ['Sunday afternoon', '2026-10-11'],
    ['Sunday evening', '2026-10-11'],
    ['Sunday night', '2026-10-11'],
    ['Monday noon', '2026-10-12'],
    ['Monday EOD', '2026-10-12'],
    ['tomorrow morning', '2026-10-11'],
    ['today evening', '2026-10-10'],
    ['Sunday morning.', '2026-10-11'],
  ])('%s → %s', (raw, date) => {
    expect(resolveDueDate(raw, SAT_1005).date).toBe(date);
  });

  it('the stored promise: resolved wins over the model\'s 20 Oct', () => {
    const p: ExtractedPromise = {
      text: 'Send the floor plans', owner: 'rep', due_date: '2026-10-20', due_raw: 'Sunday morning', confidence: 'high',
      source_span: "Sure, I'll send them Sunday morning", source_message_at: SAT_1005,
    } as ExtractedPromise;
    resolveExtractionDates({ promises: [p], key_dates: [] }, '2026-10-21', 'n1', { log: () => {} });
    expect(p.resolved_due_date).toBe('2026-10-11');
    expect(effectiveDueDate(p)).toBe('2026-10-11');
  });
});

describe('[P39-5] negative: a time of day never makes a guess resolvable', () => {
  it.each([
    'next Sunday morning',   // which week "next" means is still ambiguous
    'morning',               // a time of day alone is not a date
  ])('%s → null', (raw) => {
    expect(resolveDueDate(raw, SAT_1005)).toEqual({ date: null, resolution: null });
  });

  it('no anchor → still null', () => {
    expect(resolveDueDate('Sunday morning', null)).toEqual({ date: null, resolution: null });
  });

  it('a date with no year plus a time of day stays null ("March 3rd morning")', () => {
    expect(resolveDueDate('March 3rd morning', SAT_1005).date).toBeNull();
  });
});

describe('[P39-5] the stored row is corrected by the existing re-date backfill (dry run by default)', () => {
  it('"Sunday morning" stored as 20 Oct → a planned change to 11 Oct; a rep-edited one is skipped', async () => {
    const { planPromiseRedate } = await import('../../scripts/backfill-promise-dates.js');
    const plan = planPromiseRedate([
      { id: 'p1', userId: 'u1', dueRaw: 'Sunday morning', dueDate: '2026-10-20', anchor: SAT_1005, dayFirst: true, repEdited: false },
      { id: 'p2', userId: 'u1', dueRaw: 'Sunday morning', dueDate: '2026-10-20', anchor: SAT_1005, dayFirst: true, repEdited: true },
    ]);
    expect(plan.changes).toEqual([{ id: 'p1', userId: 'u1', dueRaw: 'Sunday morning', from: '2026-10-20', to: '2026-10-11' }]);
    expect(plan.skippedRepEdited.map((r) => r.id)).toEqual(['p2']);
  });
});
