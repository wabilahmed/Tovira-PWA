import { describe, it, expect } from 'vitest';
import { resolveDueDate, resolveExtractionDates } from './resolve-date.js';
import type { Extraction, ExtractedPromise, KeyDate } from './types.js';

const promise = (over: Partial<ExtractedPromise>): ExtractedPromise => ({
  text: 'do the thing', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', ...over,
});
const emptyExtraction = (over: Partial<Extraction> = {}): Extraction => ({
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null, ...over,
});

// [P14-3] Deterministic post-extraction date resolution, anchored to the DATE OF THE MESSAGE the promise
// was said in (source_message_at) — NOT a single import reference date. This is the import bug: a chat
// spanning months/years has one import reference, so "by Thursday" said long ago resolved to a date
// before the reference and was nulled. Anchored to its own message, it resolves correctly.
//
// The resolver never GUESSES — it returns null for exactly what the certified extraction prompt leaves
// null: vague timing, a date with no year, and an AMBIGUOUS numeric date whose day/month order is not
// forced. It is deterministic and locale-free.
describe('[P14-3] resolveDueDate — relative phrases anchored to the message date', () => {
  // Mon 2 Mar 2026 is the anchor the reports use.
  const MON_2_MAR = '2026-03-02T09:30';

  it('"by Thursday" said on Mon 2 Mar 2026 → Thu 5 Mar 2026 (relative)', () => {
    expect(resolveDueDate('by Thursday', MON_2_MAR)).toEqual({ date: '2026-03-05', resolution: 'relative' });
  });

  it('"Thursday" and "this Thursday" resolve the same (the next Thursday on/after the anchor)', () => {
    expect(resolveDueDate('Thursday', MON_2_MAR).date).toBe('2026-03-05');
    expect(resolveDueDate('this Thursday', MON_2_MAR).date).toBe('2026-03-05');
  });

  it('"next Thursday" stays null — which week it means is ambiguous in English, so resolving it would guess', () => {
    expect(resolveDueDate('next Thursday', MON_2_MAR)).toEqual({ date: null, resolution: null });
  });

  // [P18-2] STRICTLY AFTER: a weekday named on that same weekday means NEXT week, never the same day.
  it('a weekday named ON that weekday resolves to NEXT week ("on Monday" sent Mon 20 Apr → 27 Apr)', () => {
    expect(resolveDueDate('on Monday', '2026-04-20T09:00').date).toBe('2026-04-27'); // 20 Apr 2026 is a Monday
    expect(resolveDueDate('Thursday', '2026-03-05T10:00').date).toBe('2026-03-12'); // anchor Thu → next Thu
  });

  it('"tomorrow" said on 3 Mar → 4 Mar; "today" → the message day', () => {
    expect(resolveDueDate('tomorrow', '2026-03-03T08:00')).toEqual({ date: '2026-03-04', resolution: 'relative' });
    expect(resolveDueDate('today', '2026-03-03T08:00')).toEqual({ date: '2026-03-03', resolution: 'relative' });
  });

  it('"in two weeks" / "in 3 days" count from the message day', () => {
    expect(resolveDueDate('in two weeks', MON_2_MAR).date).toBe('2026-03-16');
    expect(resolveDueDate('in 3 days', MON_2_MAR).date).toBe('2026-03-05');
  });

  it('crosses a month/year boundary correctly ("Friday" said Tue 29 Dec 2026 → Fri 1 Jan 2027)', () => {
    expect(resolveDueDate('Friday', '2026-12-29T12:00').date).toBe('2027-01-01');
  });

  it('a relative phrase with NO anchor (voice/paste note, source_message_at null) stays null — nothing to anchor to', () => {
    expect(resolveDueDate('by Thursday', null)).toEqual({ date: null, resolution: null });
  });
});

// [P18-2] Arabic forms of today/tomorrow/weekdays (with or without the leading "يوم").
describe('[P18-2] resolveDueDate — Arabic relative dates', () => {
  it('غداً (tomorrow) said 3 Mar → 4 Mar; اليوم (today) → the message day', () => {
    expect(resolveDueDate('غداً', '2026-03-03T08:00').date).toBe('2026-03-04');
    expect(resolveDueDate('اليوم', '2026-03-03T08:00').date).toBe('2026-03-03');
  });
  it('an Arabic weekday resolves strictly after ("الخميس" said Mon 2 Mar → Thu 5 Mar)', () => {
    expect(resolveDueDate('الخميس', '2026-03-02T09:30').date).toBe('2026-03-05');
  });
  it('accepts the "يوم <weekday>" form', () => {
    expect(resolveDueDate('يوم الجمعة', '2026-03-02T09:30').date).toBe('2026-03-06'); // Friday after Mon 2 Mar
  });
});

describe('[P14-3] resolveDueDate — explicit dates', () => {
  it('an ISO date resolves as explicit, regardless of the anchor', () => {
    expect(resolveDueDate('2026-04-12', '2026-03-02T09:30')).toEqual({ date: '2026-04-12', resolution: 'explicit' });
    expect(resolveDueDate('2026-04-12', null).date).toBe('2026-04-12');
  });

  it('a numeric date whose order is FORCED (one component > 12) resolves as explicit', () => {
    // 22/08/2026 can only be 22 August.
    expect(resolveDueDate('22/08/2026', null)).toEqual({ date: '2026-08-22', resolution: 'explicit' });
    // 2026/13/... impossible month in one order forces the other; 08/22/2026 → 22 Aug.
    expect(resolveDueDate('08/22/2026', null).date).toBe('2026-08-22');
  });
});

describe('[P14-3] resolveDueDate — NEVER guesses (returns null, same as the certified prompt)', () => {
  it('an AMBIGUOUS numeric date (both components <= 12) stays null — day/month order is a locale guess', () => {
    // "12/04/2026" is 12 Apr OR 4 Dec. The certified prompt refuses to guess the locale; so do we.
    expect(resolveDueDate('12/04/2026', '2026-03-02T09:30')).toEqual({ date: null, resolution: null });
    expect(resolveDueDate('12/04/2026 at 3pm', '2026-03-02T09:30').date).toBeNull();
  });

  it('a date with no year stays null (never infer the year)', () => {
    expect(resolveDueDate('March 3rd', '2026-03-02T09:30').date).toBeNull();
    expect(resolveDueDate('the 14th', '2026-03-02T09:30').date).toBeNull();
  });

  it('vague timing stays null', () => {
    expect(resolveDueDate('sometime after the holidays', '2026-03-02T09:30').date).toBeNull();
    expect(resolveDueDate('later this quarter', '2026-03-02T09:30').date).toBeNull();
    expect(resolveDueDate('', '2026-03-02T09:30').date).toBeNull();
    expect(resolveDueDate(null, '2026-03-02T09:30').date).toBeNull();
  });
});

// The whole point of P14-3: a promise from an imported chat resolves against its OWN message, not the
// single import reference date — so it is no longer wrongly nulled by the invariant.
describe('[P14-3] resolveExtractionDates — the import bug', () => {
  it('an old import promise ("by Thursday", said Mon 2 Mar) resolves to Thu 5 Mar — NOT nulled by the invariant', () => {
    // The note is imported on 5 Oct 2026 (the single reference date) — far after the message.
    const ex = emptyExtraction({ promises: [promise({ due_raw: 'by Thursday', source_message_at: '2026-03-02T09:30', due_date: null })] });
    resolveExtractionDates(ex, '2026-10-05', 'n1');
    expect(ex.promises[0]!.resolved_due_date).toBe('2026-03-05');
    expect(ex.promises[0]!.resolution).toBe('relative');
    expect(ex.promises[0]!.confidence).toBe('high'); // NOT dropped to low — it is a valid, resolved date
  });

  it('the model\'s own due_date is left untouched; the resolved date is separate', () => {
    const ex = emptyExtraction({ promises: [promise({ due_raw: 'tomorrow', source_message_at: '2026-03-03T08:00', due_date: '2026-10-06' })] });
    resolveExtractionDates(ex, '2026-10-05', 'n1');
    expect(ex.promises[0]!.due_date).toBe('2026-10-06');       // model output preserved (provenance)
    expect(ex.promises[0]!.resolved_due_date).toBe('2026-03-04'); // deterministic, message-anchored
  });

  it('a voice/paste promise (no source_message_at) falls back to the note reference date and still resolves', () => {
    const ex = emptyExtraction({ promises: [promise({ due_raw: 'in 3 days', source_message_at: null, due_date: '2026-10-08' })] });
    resolveExtractionDates(ex, '2026-10-05', 'n1');
    // No anchor → the relative phrase cannot be resolved deterministically; the model's value is kept for surfacing.
    expect(ex.promises[0]!.resolved_due_date).toBeNull();
    expect(ex.promises[0]!.due_date).toBe('2026-10-08');
  });

  it('INVARIANT: a promise due BEFORE the message that made it is impossible — nulled everywhere, dropped to low', () => {
    // An explicit past date, earlier than the message day → a commitment can't be due before it was made.
    const ex = emptyExtraction({ promises: [promise({ due_raw: '2026-02-01', source_message_at: '2026-03-02T09:30', due_date: '2026-02-01' })] });
    resolveExtractionDates(ex, '2026-10-05', 'n1');
    expect(ex.promises[0]!.due_date).toBeNull();
    expect(ex.promises[0]!.resolved_due_date).toBeNull();
    expect(ex.promises[0]!.confidence).toBe('low');
  });

  it('a key date resolves against its message but is NOT invariant-checked (past dates are legitimate)', () => {
    const kd: KeyDate = { description: 'anniversary', date: null, date_raw: '2025-06-15', type: 'date', source_message_at: '2026-03-02T09:30' };
    const ex = emptyExtraction({ key_dates: [kd] });
    resolveExtractionDates(ex, '2026-10-05', 'n1');
    expect(ex.key_dates[0]!.resolved_date).toBe('2025-06-15'); // in the past, kept — not nulled
    expect(ex.key_dates[0]!.resolution).toBe('explicit');
  });
});
