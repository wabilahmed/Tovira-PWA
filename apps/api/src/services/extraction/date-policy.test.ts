import { describe, it, expect } from 'vitest';
import { trustedPromiseDate, trustedKeyDate, trustedMeetingDatetime } from './date-policy.js';
import type { ExtractedPromise, KeyDate, Meeting } from './types.js';

/**
 * [P40-1] A stored date comes from the deterministic resolver, never from the model's own guess. When the resolver
 * has nothing: null, the raw phrase kept, and the item marked "date to confirm". One exception: the model's date
 * stands when the receipt quote itself carries that exact explicit date and the resolver reads it the same way.
 */
const promise = (o: Partial<ExtractedPromise>): ExtractedPromise => ({ text: 'Send the floor plans', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', ...o });

describe('[P40-1] promise dates', () => {
  it('the resolver\'s date wins', () => {
    expect(trustedPromiseDate(promise({ due_date: '2026-10-20', due_raw: 'Sunday morning', resolved_due_date: '2026-10-11' }))).toEqual({ date: '2026-10-11', toConfirm: false });
  });

  it('the P39 case with the resolver failing: null + to confirm, never the model\'s 20 Oct', () => {
    expect(trustedPromiseDate(promise({ due_date: '2026-10-20', due_raw: 'Sunday morning', resolved_due_date: null, source_span: "Sure, I'll send them Sunday morning", source_message_at: '2026-10-10T10:05' }))).toEqual({ date: null, toConfirm: true });
  });

  it('exception: the quote itself says "25/04/2026" and the resolver reads the same date → kept', () => {
    expect(trustedPromiseDate(promise({ due_date: '2026-04-25', due_raw: 'by the 25th', resolved_due_date: null, source_span: 'I will pay the deposit on 25/04/2026' }))).toEqual({ date: '2026-04-25', toConfirm: false });
  });

  it('negative: an explicit date in the quote that differs from the model\'s → null + to confirm', () => {
    expect(trustedPromiseDate(promise({ due_date: '2026-04-26', due_raw: 'by the 25th', resolved_due_date: null, source_span: 'I will pay the deposit on 25/04/2026' }))).toEqual({ date: null, toConfirm: true });
  });

  it('negative: "25 April" with no year is not readable without guessing → null + to confirm', () => {
    expect(trustedPromiseDate(promise({ due_date: '2026-04-25', due_raw: '25 April', resolved_due_date: null, source_span: 'deposit on 25 April' }))).toEqual({ date: null, toConfirm: true });
  });

  it('no phrase and no model date → simply undated, nothing to confirm', () => {
    expect(trustedPromiseDate(promise({}))).toEqual({ date: null, toConfirm: false });
  });
});

describe('[P40-1] key dates and meetings follow the same rule', () => {
  it('a key date the resolver can\'t read → null + to confirm', () => {
    const k: KeyDate = { description: 'Lease ends', date: '2026-12-01', date_raw: 'end of the year', type: 'deadline', resolved_date: null };
    expect(trustedKeyDate(k)).toEqual({ date: null, toConfirm: true });
  });

  it('a meeting the resolver can\'t read → null, never the model\'s datetime', () => {
    const m: Meeting = { datetime: '2026-07-14T15:00', datetime_raw: 'next Tuesday 3pm', confirmed: false, resolved_datetime: null };
    expect(trustedMeetingDatetime(m)).toBeNull();
  });

  it('a meeting the resolver read → its wall clock', () => {
    const m: Meeting = { datetime: '2026-07-15T15:00', datetime_raw: 'Tuesday 3pm', confirmed: false, resolved_datetime: '2026-07-14T15:00' };
    expect(trustedMeetingDatetime(m)).toBe('2026-07-14T15:00');
  });

  it('exception: the quote carries the explicit date and time the model gave → kept', () => {
    const m: Meeting = { datetime: '2026-04-25T15:00', datetime_raw: 'then', confirmed: false, resolved_datetime: null, source_span: 'see you 25/04/2026 at 3pm' };
    expect(trustedMeetingDatetime(m)).toBe('2026-04-25T15:00');
  });
});
