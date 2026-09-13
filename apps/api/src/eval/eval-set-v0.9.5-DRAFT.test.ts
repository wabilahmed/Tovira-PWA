import { describe, it, expect } from 'vitest';
import { V095_DRAFT_FIXTURES, type V095FactType } from './eval-set-v0.9.5-DRAFT.js';

// [RECEIPTS-v0.9.5 DRAFT FIXTURES] Fixture-SHAPE tests only — no model calls, no accuracy verification.
// They assert the draft fixtures exercise the new fields as intended and encode the null-discipline for
// ambiguous timestamps. Accuracy against the model is a separate certification batch.
describe('[RECEIPTS-v0.9.5 DRAFT] fixture shape', () => {
  it('covers all five newly-receipted fact types, with a clean AND an ambiguous case each', () => {
    const types: V095FactType[] = ['promise', 'person', 'personal_fact', 'key_date', 'meeting'];
    for (const t of types) {
      const forType = V095_DRAFT_FIXTURES.filter((f) => f.factType === t);
      expect(forType.some((f) => f.kind === 'clean'), `${t} clean`).toBe(true);
      expect(forType.some((f) => f.kind === 'ambiguous'), `${t} ambiguous`).toBe(true);
    }
  });

  it('clean cases populate BOTH receipt fields from a per-message-timestamped import', () => {
    for (const f of V095_DRAFT_FIXTURES.filter((f) => f.kind === 'clean')) {
      expect(f.source, `${f.id} source`).toBe('whatsapp_export');
      expect(typeof f.expected.source_span).toBe('string');
      expect(f.expected.source_span!.length).toBeGreaterThan(0);
      expect(typeof f.expected.source_message_at, `${f.id} time`).toBe('string');
    }
  });

  it('ambiguous cases (no per-message timestamp) expect source_message_at null — never a guess', () => {
    for (const f of V095_DRAFT_FIXTURES.filter((f) => f.kind === 'ambiguous')) {
      expect(['voice', 'paste', 'ask_conversation'], `${f.id} source`).toContain(f.source);
      expect(f.expected.source_message_at, `${f.id} must be null`).toBeNull();
    }
  });

  it('the source_span is an excerpt, not the whole note, where the note is longer', () => {
    // On the clean imports the note is a multi-line thread; the span must be shorter than the full note.
    for (const f of V095_DRAFT_FIXTURES.filter((f) => f.kind === 'clean')) {
      expect(f.expected.source_span!.length).toBeLessThan(f.note.length);
    }
  });
});
