import { describe, it, expect } from 'vitest';
import { planWindows, mergeWindowExtractions, markKeptPromises } from './windowed.js';
import type { Extraction, ExtractedPromise } from './types.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/** [P23-B4] Windowed extraction — the pure parts: window boundaries, the merge, kept promises. */
const empty = (o: Partial<Extraction> = {}): Extraction => ({ summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null, ...o });
const promise = (text: string, at: string | null, o: Partial<ExtractedPromise> = {}): ExtractedPromise => ({ text, owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: text, source_message_at: at, ...o });
const msg = (sender: string, sentAt: string, body: string, role: ImportedMessage['role']): ImportedMessage => ({ sender, sentAt, body, media: false, role });
const cfg = { threshold: 150, size: 120, overlap: 20 };

describe('[P23-B4] planWindows', () => {
  it('a chat at or below the threshold is not windowed (null → single pass, exactly as today)', () => {
    expect(planWindows(150, cfg)).toBeNull();
    expect(planWindows(1, cfg)).toBeNull();
  });
  it('over the threshold: windows of W overlapping by O, covering every message, the last ending at the end', () => {
    expect(planWindows(151, cfg)).toEqual([[0, 120], [100, 151]]);
    expect(planWindows(302, cfg)).toEqual([[0, 120], [100, 220], [200, 302]]);
    const w = planWindows(418, cfg)!;
    expect(w[0]![0]).toBe(0);
    expect(w.at(-1)![1]).toBe(418);
    for (let i = 1; i < w.length; i++) expect(w[i]![0]).toBe(w[i - 1]![1] - 20); // exact overlap
    for (const [s, e] of w) expect(e - s).toBeLessThanOrEqual(120);
  });
  it('a tail shorter than the overlap is folded into the previous window (no window that only repeats the overlap)', () => {
    expect(planWindows(225, cfg)).toEqual([[0, 120], [100, 225]]); // not [100,220],[200,225]
  });
  it('rejects nonsense settings', () => {
    expect(() => planWindows(400, { threshold: 150, size: 20, overlap: 20 })).toThrow(/overlap/);
    expect(() => planWindows(400, { threshold: 150, size: 0, overlap: 0 })).toThrow(/size/);
  });
});

describe('[P23-B4] merge', () => {
  it('overlap dedupe: the same fact from two windows (same text + message time) appears once, receipt kept', () => {
    const a = empty({ promises: [promise('Send three villa options', '2026-02-02T10:20')], requirements: [{ text: '3-bed villa in Ranches 3', requirement_raw: 'looking for a 3-bedroom villa', stated_on: '2026-02-02', confidence: 'high' }], people: [{ name: 'Yousef', role: null, reports_to: null, decision_role: 'unknown', notes: null }] });
    const b = empty({ promises: [promise('send three villa options', '2026-02-02T10:20')], requirements: [{ text: '3-bed villa in Ranches 3', requirement_raw: 'looking for a 3-bedroom villa', stated_on: '2026-02-02', confidence: 'high' }], people: [{ name: 'Yousef', role: 'engineer', reports_to: null, decision_role: 'influencer', notes: null }] });
    const m = mergeWindowExtractions([a, b]);
    expect(m.promises).toHaveLength(1);
    expect(m.promises[0]!.source_span).toBe('Send three villa options'); // the receipt survives
    expect(m.requirements).toHaveLength(1);
    expect(m.people).toEqual([{ name: 'Yousef', role: 'engineer', reports_to: null, decision_role: 'influencer', notes: null }]); // gaps filled, not two people
  });
  it('NEGATIVE: different people are never merged, and two different promises in one message both stay', () => {
    const a = empty({ people: [{ name: 'Sara', role: null, reports_to: null, decision_role: 'unknown', notes: null }], promises: [promise('Send the floor plan', '2026-03-01T09:00'), promise('Call the developer', '2026-03-01T09:00')] });
    const b = empty({ people: [{ name: 'Sarah', role: null, reports_to: null, decision_role: 'unknown', notes: null }] });
    const m = mergeWindowExtractions([a, b]);
    expect(m.people.map((p) => p.name)).toEqual(['Sara', 'Sarah']);
    expect(m.promises).toHaveLength(2);
  });
  it('budget update across windows: the later value is current, the earlier is not kept as a second current need', () => {
    const early = empty({ requirements: [{ text: 'Budget around AED 2.5M', requirement_raw: 'Our budget is around 2.5M', stated_on: '2026-02-02', confidence: 'high' }] });
    const late = empty({ requirements: [{ text: 'Budget around AED 3.1M', requirement_raw: 'final budget is 3.1M', stated_on: '2026-05-06', confidence: 'high' }] });
    const m = mergeWindowExtractions([early, late]);
    expect(m.requirements!.map((r) => r.requirement_raw)).toEqual(['final budget is 3.1M']);
  });
  it('NEGATIVE: different needs that only share a number are not "updates" of each other', () => {
    const a = empty({ requirements: [{ text: '3-bed villa', requirement_raw: '3-bedroom villa', stated_on: '2026-02-02', confidence: 'high' }] });
    const b = empty({ requirements: [{ text: 'parking for 2 cars', requirement_raw: 'covered parking for 2 cars', stated_on: '2026-03-02', confidence: 'high' }] });
    expect(mergeWindowExtractions([a, b]).requirements).toHaveLength(2);
  });
  it('NEGATIVE: a cheque schedule is four key dates, not one "updated" date', () => {
    const kd = (d: string) => ({ description: `Rent cheque due ${d}`, date: d, date_raw: d, type: 'deadline' });
    const m = mergeWindowExtractions([empty({ key_dates: [kd('2026-10-01'), kd('2027-01-01')] }), empty({ key_dates: [kd('2027-01-01'), kd('2027-04-01'), kd('2027-07-01')] })]);
    expect(m.key_dates.map((k) => k.date)).toEqual(['2026-10-01', '2027-01-01', '2027-04-01', '2027-07-01']);
  });
  it('the meeting is the most recently arranged one; summaries are joined in order; lists deduped', () => {
    const m = mergeWindowExtractions([
      empty({ summary: 'Early: looking in Ranches 3.', meeting: { datetime: null, datetime_raw: 'Saturday 14/03/2026 at 11am', confirmed: true, source_message_at: '2026-03-04T11:30' }, concerns: ['service charges'] }),
      empty({ summary: 'Later: decided on villa 22.', meeting: { datetime: null, datetime_raw: 'Sunday 17/05/2026 at 4pm', confirmed: true, source_message_at: '2026-05-07T09:00' }, concerns: ['Service charges', 'timing'] }),
    ]);
    expect(m.meeting?.datetime_raw).toBe('Sunday 17/05/2026 at 4pm');
    expect(m.summary).toBe('Early: looking in Ranches 3. Later: decided on villa 22.');
    expect(m.concerns).toEqual(['service charges', 'timing']);
  });
});

describe('[P23-B4] kept promises across windows', () => {
  const messages = [
    msg('Wabil', '2026-02-02T10:20', "Great, I'll send you three villa options by Thursday", 'rep'),
    msg('Khalid', '2026-02-03T09:00', 'Thanks', 'client'),
    msg('Wabil', '2026-02-05T16:40', 'Here are the three villa options I promised', 'rep'),
    msg('Khalid', '2026-03-25T19:20', "I'll send you my mortgage pre-approval letter next week", 'client'),
    msg('Khalid', '2026-04-02T10:05', 'Here is the mortgage pre-approval letter from ENBD', 'client'),
    msg('Wabil', '2026-06-15T09:40', "I'll get the landlord to fix the AC before the end of the month", 'rep'),
    msg('Rania', '2026-07-02T20:00', 'The AC is still not fixed, it has been two weeks', 'client'),
  ];
  it('a promise fulfilled in a later window is kept (kept_at = the fulfilling message)', () => {
    const x = empty({ promises: [promise('Send three villa options', '2026-02-02T10:20', { due_raw: 'by Thursday' })] });
    markKeptPromises(x, messages);
    expect(x.promises[0]!.kept_at).toBe('2026-02-05T16:40');
  });
  it('a client promise is kept by the CLIENT delivering it', () => {
    const x = empty({ promises: [promise('Send the mortgage pre-approval letter', '2026-03-25T19:20', { owner: 'client' })] });
    markKeptPromises(x, messages);
    expect(x.promises[0]!.kept_at).toBe('2026-04-02T10:05');
  });
  it('NEGATIVE: a complaint that it is still not done never marks it kept; nor does the other party\'s message', () => {
    const x = empty({ promises: [promise('Get the landlord to fix the AC', '2026-06-15T09:40')] });
    markKeptPromises(x, messages);
    expect(x.promises[0]!.kept_at ?? null).toBeNull();
    const y = empty({ promises: [promise('Send the mortgage pre-approval letter', '2026-03-25T19:20', { owner: 'rep' })] }); // rep-owned; only the CLIENT sent one
    markKeptPromises(y, messages);
    expect(y.promises[0]!.kept_at ?? null).toBeNull();
  });
  it('NEGATIVE: a fulfilment BEFORE the promise was made does not count', () => {
    const x = empty({ promises: [promise('Send three villa options', '2026-02-06T09:00')] });
    markKeptPromises(x, messages);
    expect(x.promises[0]!.kept_at ?? null).toBeNull();
  });
});
