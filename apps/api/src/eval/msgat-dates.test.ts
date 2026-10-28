import { describe, it, expect } from 'vitest';
import { scoreReceipts, GATE_RECEIPTS } from './score.js';
import type { Extraction } from '../services/extraction/types.js';

// [P54-3 · owner] msgAt-not-in-source compared TEXT: a chat line "[20/10/2026, 09:10]" never contains the model's
// ISO "2026-10-20T09:10", so every correct message time "failed" (89 in the last certification). It now compares the
// moment: date and time as written in the chat (the chat's own clock), to the minute. Still reported only, never gated.
const ex = (at: string) => ({ summary: '', promises: [{ text: 'x', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: 'hi', source_message_at: at }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) as unknown as Extraction;
const notIn = (source: string, at: string) => scoreReceipts(source, ex(at), true).messageAtNotInSource;

describe('[P54-3] message times are compared as moments, not text', () => {
  it('the same moment written in the chat format and in ISO matches', () => {
    expect(notIn('[20/10/2026, 09:10] Omar: hi', '2026-10-20T09:10')).toBe(0);
    expect(notIn('[20/10/2026, 09:10:42] Omar: hi', '2026-10-20T09:10')).toBe(0);
    expect(notIn('20/10/2026, 9:10 am - Omar: hi', '2026-10-20T09:10')).toBe(0);
    expect(notIn('20/10/2026, 9:10 pm - Omar: hi', '2026-10-20T21:10')).toBe(0);
    expect(notIn('20/10/26, 12:05 am - Omar: hi', '2026-10-20T00:05')).toBe(0);
    expect(notIn('[2026-07-13T09:00:00] Omar: hi', '2026-07-13T09:00')).toBe(0);
    expect(notIn('[20/10/2026, 09:10] Omar: hi', '2026-10-20T09:10:00')).toBe(0);
  });
  it('NEGATIVE: a different minute, hour or day does not match', () => {
    expect(notIn('[20/10/2026, 09:10] Omar: hi', '2026-10-20T09:11')).toBe(1);
    expect(notIn('20/10/2026, 9:10 am - Omar: hi', '2026-10-20T21:10')).toBe(1);
    expect(notIn('[20/10/2026, 09:10] Omar: hi', '2026-10-21T09:10')).toBe(1);
    expect(notIn('[20/10/2026, 09:10] Omar: hi', '2026-20-10T09:10')).toBe(1); // day and month swapped
  });
  it('stays reported only: it is not a receipt bar', () => {
    expect(Object.keys(GATE_RECEIPTS).sort()).toEqual(['maxFabricatedSpans', 'maxMessageAtOnAmbiguous']);
  });
});
