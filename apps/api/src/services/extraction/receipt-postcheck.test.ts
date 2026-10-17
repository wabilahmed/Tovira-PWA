import { describe, it, expect } from 'vitest';
import { dropNonVerbatimSpans } from './receipt-postcheck.js';
import type { Extraction } from './types.js';

function empty(): Extraction {
  return { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null };
}

describe('[P18-8] dropNonVerbatimSpans', () => {
  it('drops a promise receipt span that is NOT a substring of the source, keeping the fact', () => {
    const ex = empty();
    ex.promises = [{ text: 'chase the supplier', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: 'chase' } as Extraction['promises'][number]];
    const dropped = dropNonVerbatimSpans(ex, "I'll follow up with the supplier tomorrow.");
    expect(dropped).toBe(1);
    expect(ex.promises[0]!.source_span).toBeNull(); // fabricated receipt removed
    expect(ex.promises[0]!.text).toBe('chase the supplier'); // the fact itself is kept
  });

  it('keeps a verbatim span that appears exactly in the source', () => {
    const ex = empty();
    ex.promises = [{ text: 'chase the supplier', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: "I'll chase the supplier tomorrow" } as Extraction['promises'][number]];
    const dropped = dropNonVerbatimSpans(ex, "I'll chase the supplier tomorrow, promise.");
    expect(dropped).toBe(0);
    expect(ex.promises[0]!.source_span).toBe("I'll chase the supplier tomorrow");
  });

  it('is whitespace-tolerant (a newline the model rendered as a space still matches)', () => {
    const ex = empty();
    ex.key_dates = [{ description: 'launch', date: '2026-05-01', date_raw: null, type: 'launch', source_span: 'launch on 1 May' } as Extraction['key_dates'][number]];
    const dropped = dropNonVerbatimSpans(ex, 'the\nlaunch   on 1 May is set');
    expect(dropped).toBe(0);
    expect(ex.key_dates[0]!.source_span).toBe('launch on 1 May');
  });

  it('checks people, personal_facts, and the meeting too', () => {
    const ex = empty();
    ex.people = [{ name: 'Sara', source_span: 'invented' } as Extraction['people'][number]];
    ex.personal_facts = [{ subject: 'Sara', fact: 'likes tea', source_span: 'likes tea' } as Extraction['personal_facts'][number]];
    ex.meeting = { datetime: null, datetime_raw: 'Tuesday', confirmed: false, source_span: 'never said this' } as Extraction['meeting'];
    const dropped = dropNonVerbatimSpans(ex, 'Sara likes tea.');
    expect(dropped).toBe(2); // 'invented' + 'never said this' dropped; 'likes tea' kept
    expect(ex.people[0]!.source_span).toBeNull();
    expect(ex.personal_facts[0]!.source_span).toBe('likes tea');
    expect(ex.meeting!.source_span).toBeNull();
  });

  it('leaves a null/absent span alone (nothing to verify)', () => {
    const ex = empty();
    ex.promises = [{ text: 'x', owner: 'rep', due_date: null, due_raw: null, confidence: 'low', source_span: null } as Extraction['promises'][number]];
    expect(dropNonVerbatimSpans(ex, 'anything')).toBe(0);
    expect(ex.promises[0]!.source_span).toBeNull();
  });
});
