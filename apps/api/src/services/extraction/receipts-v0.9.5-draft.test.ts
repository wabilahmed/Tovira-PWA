import { describe, it, expect } from 'vitest';
import {
  V095_RECEIPT_FACT_TYPES,
  DETERMINISTIC_MESSAGE_TIME_SOURCES,
  AMBIGUOUS_MESSAGE_TIME_SOURCES,
  type SourceReceipt,
  type PromiseV095,
  type PersonV095,
  type PersonalFactV095,
  type KeyDateV095,
  type MeetingV095,
} from './receipts-v0.9.5-draft.js';

// [RECEIPTS-v0.9.5 DRAFT] Shape tests only — no model calls, no accuracy claims. These assert the
// extended shape is CONSISTENT across the five fact types (one receipt pattern, not five), and that
// the determinism split for source_message_at is declared, not silently defaulted. Accuracy is proven
// later in the certification batch.
describe('[RECEIPTS-v0.9.5 DRAFT] per-fact receipt shape', () => {
  // One typed fixture per fact type — the TS compiler is the real schema check; these assert at runtime
  // that both receipt fields are present and carry the excerpt / timestamp (or null), never absent.
  const promise: PromiseV095 = { text: 'Send the revised quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high', source_span: 'I’ll send the revised quote by Thursday', source_message_at: '2026-03-14T09:00:00Z' };
  const person: PersonV095 = { name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: 'Omar Al Mansouri', source_message_at: null };
  const personalFact: PersonalFactV095 = { subject: 'Omar', fact: 'daughter started university', category: 'family', source_span: 'his daughter just started at LSE', source_message_at: '2026-03-03T12:00:00Z' };
  const keyDate: KeyDateV095 = { description: 'exhibition', date: null, date_raw: 'March', type: 'other', source_span: 'our exhibition is in March', source_message_at: null };
  const meeting: MeetingV095 = { datetime: null, datetime_raw: 'Thursday', confirmed: true, source_span: 'locked in for Thursday 3pm', source_message_at: '2026-03-10T15:00:00Z' };

  const fixtures: Record<string, SourceReceipt> = { promise, person, personal_fact: personalFact, key_date: keyDate, meeting };

  it('applies the SAME two receipt fields to all five fact types (one pattern, not five)', () => {
    for (const key of V095_RECEIPT_FACT_TYPES) {
      const f = fixtures[key]!;
      expect(f).toHaveProperty('source_span');
      expect(f).toHaveProperty('source_message_at');
      // source_span is an excerpt string or null; source_message_at is an ISO string or null.
      expect(f.source_span === null || typeof f.source_span === 'string').toBe(true);
      expect(f.source_message_at === null || typeof f.source_message_at === 'string').toBe(true);
    }
  });

  it('covers exactly the five types that lack a receipt today (requirements + questions already have one)', () => {
    expect([...V095_RECEIPT_FACT_TYPES].sort()).toEqual(['key_date', 'meeting', 'person', 'personal_fact', 'promise']);
    expect(V095_RECEIPT_FACT_TYPES as readonly string[]).not.toContain('requirement');
    expect(V095_RECEIPT_FACT_TYPES as readonly string[]).not.toContain('unanswered_question');
  });

  it('declares the source_message_at determinism split with no overlap and no silent fallback', () => {
    // whatsapp_export is deterministic; voice/paste/ask are ambiguous → null. The two sets are disjoint
    // and together cover every extraction source, so no source is left to an unstated default.
    const det = new Set<string>(DETERMINISTIC_MESSAGE_TIME_SOURCES);
    const amb = new Set<string>(AMBIGUOUS_MESSAGE_TIME_SOURCES);
    for (const s of det) expect(amb.has(s)).toBe(false);
    expect([...det, ...amb].sort()).toEqual(['ask_conversation', 'paste', 'voice', 'whatsapp_export']);
  });
});
