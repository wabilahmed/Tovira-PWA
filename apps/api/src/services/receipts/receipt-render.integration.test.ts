import { describe, it, expect } from 'vitest';
import { noteWithReceipts } from './receipt.js';

/**
 * [RECEIPTS-v0.9.5 Task 3] DECOUPLING PROOF. A note's receipts are rendered from the facts' stored
 * source_span, not from the note body. So a note whose raw_text has been deleted still renders full
 * receipts. We simulate deletion directly: set rawText to null and assert the receipts survive.
 */

const CAPTURE_MS = Date.parse('2026-09-14T08:35:00Z');

function noteWithFacts(rawText: string | null) {
  return {
    id: 'n1', createdAt: CAPTURE_MS, rawText,
    extracted: {
      summary: 's',
      promises: [{ text: 'Send the quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high',
        source_span: "I'll send the quote Thursday", source_message_at: '2026-09-14T10:01:00Z' }],
      people: [{ name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null,
        source_span: 'Omar: any update?', source_message_at: null }],
      personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
    },
  };
}

describe('[RECEIPTS-v0.9.5 Task 3] receipts survive raw_text deletion', () => {
  it('renders full receipts even when the note raw_text row is gone (rawText = null)', () => {
    const deleted = noteWithFacts(null); // the raw body has been deleted
    const rendered = noteWithReceipts(deleted);
    const ex = rendered.extracted as unknown as { promises: Array<{ receipt: { quote: string | null; source: string; at: string | null } }>; people: Array<{ receipt: { quote: string | null; source: string; at: string | null } }> };
    // Promise receipt comes from the stored span + its message time — not from rawText.
    expect(ex.promises[0]!.receipt.quote).toBe("I'll send the quote Thursday");
    expect(ex.promises[0]!.receipt.source).toBe('message');
    // Person receipt (no message time) falls back to the capture date — still not rawText.
    expect(ex.people[0]!.receipt.quote).toBe('Omar: any update?');
    expect(ex.people[0]!.receipt.source).toBe('capture');
    expect(ex.people[0]!.receipt.at).toBe('2026-09-14');
  });

  it('renders identically whether raw_text is present or deleted (receipt is independent of it)', () => {
    const withRaw = noteWithReceipts(noteWithFacts('the full original note body ...')).extracted as unknown as { promises: Array<{ receipt: unknown }> };
    const withoutRaw = noteWithReceipts(noteWithFacts(null)).extracted as unknown as { promises: Array<{ receipt: unknown }> };
    expect(withoutRaw.promises[0]!.receipt).toEqual(withRaw.promises[0]!.receipt);
  });
});
