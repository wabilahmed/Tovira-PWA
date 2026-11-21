import { describe, it, expect } from 'vitest';
import { resolveDueDate, resolveExtractionDates, resolveDateTime } from './resolve-date.js';
import { trustedKeyDate } from './date-policy.js';
import type { ExtractedPromise, KeyDate } from './types.js';

/**
 * [P83-6 · owner, 21 Nov] A date written out in full with a month NAME and a year ("30 June 2026") is as fixed as
 * "30/06/2026" and must resolve. Before this the resolver read only numeric and ISO dates, so the accuracy key's
 * O11 ("Our lease ends on 30 June 2026"), M18 ("1 September 2026") and X14 ("1 to 20 December 2026") all stored
 * null. A range stores its START date; the raw phrase is kept unchanged by the caller.
 */
const ANCHOR = '2026-04-02T19:20';

describe('[P83-6] full dates with a month name resolve', () => {
  it('O11: "30 June 2026" → 2026-06-30 (explicit)', () => {
    expect(resolveDueDate('30 June 2026', ANCHOR)).toEqual({ date: '2026-06-30', resolution: 'explicit' });
  });
  it('M18: "1 September 2026" → 2026-09-01', () => {
    expect(resolveDueDate('1 September 2026', ANCHOR).date).toBe('2026-09-01');
  });
  it('X14: "1 to 20 December 2026" → the START date 2026-12-01', () => {
    expect(resolveDueDate('1 to 20 December 2026', ANCHOR)).toEqual({ date: '2026-12-01', resolution: 'explicit' });
  });
  it.each([
    ['30th June 2026', '2026-06-30'],
    ['June 30, 2026', '2026-06-30'],
    ['June 30 2026', '2026-06-30'],
    ['June 30th, 2026', '2026-06-30'],
    ['30 Jun 2026', '2026-06-30'],
    ['30 June, 2026', '2026-06-30'],
    ['on 30 June 2026', '2026-06-30'],
    ['by 1 Sept 2026', '2026-09-01'],
    ['1-20 December 2026', '2026-12-01'],
    ['1 - 20 Dec 2026', '2026-12-01'],
    ['1–20 December 2026', '2026-12-01'],
    ['from 1 to 20 December 2026', '2026-12-01'],
    ['between 1 and 20 December 2026', '2026-12-01'],
    ['28 Nov to 3 Dec 2026', '2026-11-28'],
    ['28 November - 3 December 2026', '2026-11-28'],
    ['December 1 to 20, 2026', '2026-12-01'],
  ])('"%s" → %s', (raw, want) => {
    expect(resolveDueDate(raw, ANCHOR).date).toBe(want);
  });
  it('resolves with no anchor at all (a full date needs none)', () => {
    expect(resolveDueDate('30 June 2026', null).date).toBe('2026-06-30');
  });
  it('a cross-year range "28 Dec to 3 Jan 2027" starts in the year before', () => {
    expect(resolveDueDate('28 Dec to 3 Jan 2027', null).date).toBe('2026-12-28');
  });
});

describe('[P83-6] NEGATIVE: what was null stays null', () => {
  it.each([
    'end of the quarter', 'sometime after the holidays', 'after Eid', 'December', 'September', 'this week', 'later this year',
  ])('vague "%s" stays null', (raw) => {
    expect(resolveDueDate(raw, ANCHOR)).toEqual({ date: null, resolution: null });
  });
  it('an impossible date "31 June 2026" stays null (never rolls over to 1 July)', () => {
    expect(resolveDueDate('31 June 2026', ANCHOR)).toEqual({ date: null, resolution: null });
    expect(resolveDueDate('June 31, 2026', ANCHOR).date).toBeNull();
    expect(resolveDueDate('29 February 2026', ANCHOR).date).toBeNull();
  });
  it('a range whose start is impossible stays null', () => {
    expect(resolveDueDate('31 June to 3 July 2026', ANCHOR).date).toBeNull();
  });
  it('a range that runs backwards stays null ("20 to 1 December 2026")', () => {
    expect(resolveDueDate('20 to 1 December 2026', ANCHOR).date).toBeNull();
  });
  it('a day and month with NO year keeps the existing rule (null): "2 October", "30 June", "30th of June"', () => {
    expect(resolveDueDate('2 October', ANCHOR).date).toBeNull();
    expect(resolveDueDate('30 June', ANCHOR).date).toBeNull();
    expect(resolveDueDate('June 30th', ANCHOR).date).toBeNull();
    expect(resolveDueDate('1 to 20 December', ANCHOR).date).toBeNull();
  });
  it('a month word that is not a month ("may") never makes a date: "30 may 2026" is May, "30 mayday 2026" is nothing', () => {
    expect(resolveDueDate('30 May 2026', ANCHOR).date).toBe('2026-05-30');
    expect(resolveDueDate('30 mayday 2026', ANCHOR).date).toBeNull();
  });
  it('a full date buried in a longer sentence is not pulled out by resolveDueDate (phrase rule unchanged)', () => {
    expect(resolveDueDate('sometime before 30 June 2026 maybe', ANCHOR).date).toBeNull();
  });
  it('existing forms are unchanged: numeric, ISO, relative', () => {
    expect(resolveDueDate('15/04/2026', ANCHOR).date).toBe('2026-04-15');
    expect(resolveDueDate('2026-06-30', ANCHOR).date).toBe('2026-06-30');
    expect(resolveDueDate('tomorrow', '2026-03-05T10:00').date).toBe('2026-03-06');
  });
});

describe('[P83-6] the full date reaches what is stored (key_dates and promises)', () => {
  it('resolveExtractionDates fills resolved_date for a key date and resolved_due_date for a promise; the raw phrase is kept unchanged', () => {
    const k: KeyDate = { description: 'Away', date: null, date_raw: '1 to 20 December 2026', type: 'other', source_message_at: '2026-10-01T09:30' } as KeyDate;
    const lease: KeyDate = { description: 'Current lease ends', date: null, date_raw: '30 June 2026', type: 'deadline', source_message_at: ANCHOR } as KeyDate;
    const p: ExtractedPromise = { text: 'Send the contract', owner: 'rep', due_date: null, due_raw: 'by 1 September 2026', confidence: 'high', source_message_at: ANCHOR } as ExtractedPromise;
    const ex = { promises: [p], key_dates: [k, lease], meeting: null };
    resolveExtractionDates(ex, '2026-11-01', 'n1', { dayFirst: true, log: () => undefined });
    expect(k.resolved_date).toBe('2026-12-01');
    expect(k.date_raw).toBe('1 to 20 December 2026');
    expect(lease.resolved_date).toBe('2026-06-30');
    expect(p.resolved_due_date).toBe('2026-09-01');
    expect(trustedKeyDate(k).date).toBe('2026-12-01');
  });
  it('when the model gave a date but no raw phrase, the model date stands only if the quote carries that full date', () => {
    const k: KeyDate = { description: 'Current lease ends', date: '2026-06-30', date_raw: null, type: 'deadline', source_span: 'Our lease ends on 30 June 2026' } as KeyDate;
    expect(trustedKeyDate(k)).toEqual({ date: '2026-06-30', toConfirm: false });
    const wrong: KeyDate = { ...k, date: '2026-07-01' } as KeyDate;
    expect(trustedKeyDate(wrong)).toEqual({ date: null, toConfirm: true });
  });
  it('a meeting with a full written date and a clock time resolves', () => {
    expect(resolveDateTime('Viewing on Sunday 17 May 2026 at 4pm', '2026-05-07T09:00').datetime).toBe('2026-05-17T16:00');
  });
});
