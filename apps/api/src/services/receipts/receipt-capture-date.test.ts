import { describe, it, expect } from 'vitest';
import { withReceipt, noteWithReceipts } from './receipt.js';

/**
 * [RECEIPTS-capture-date Task 2] The capture-date fallback must render the CONVERSATION date, not
 * the import date. A fact's own created_at is the import/insert time — for a two-year-old WhatsApp
 * import, using it would stamp every receipt with today's date. The fix: relational facts carry a
 * denormalised `captureAt` (the note's referenceDate: latest message date for chats, capture date
 * for voice/paste); the per-note view derives the same via referenceDateFor over the note's messages.
 */

const TODAY_MS = Date.parse('2026-09-19T12:00:00Z'); // "the import ran today"
const CONV_DATE = '2024-03-15'; // the conversation actually happened in 2024

describe('[RECEIPTS-capture-date Task 2] relational surfaces use captureAt, not the import time', () => {
  it('IMPORT GAP: a 2024 conversation imported today renders 2024, not today', () => {
    // captureAt = the conversation date; createdAt = the import time (today).
    const promise = { id: 'p1', sourceSpan: 'send the payment plan', sourceMessageAt: null, captureAt: CONV_DATE, createdAt: TODAY_MS };
    const out = withReceipt(promise);
    expect(out.receipt.source).toBe('capture');
    expect(out.receipt.at).toBe('2024-03-15');            // the conversation date
    expect(out.receipt.at).not.toBe('2026-09-19');        // NOT the import date
    expect(out.receipt.label).toBe('Quoted from your capture on 2024-03-15');
  });

  it('a fact with a real source_message_at still renders that, unaffected', () => {
    const promise = { id: 'p2', sourceSpan: 'send the quote', sourceMessageAt: '2024-03-15T10:01:00', captureAt: CONV_DATE, createdAt: TODAY_MS };
    const out = withReceipt(promise);
    expect(out.receipt.source).toBe('message');
    expect(out.receipt.at).toBe('2024-03-15T10:01:00');
  });

  it('a pre-existing fact (captureAt = null) falls back HONESTLY — no date, never the import date', () => {
    const promise = { id: 'p3', sourceSpan: 'send the quote', sourceMessageAt: null, captureAt: null, createdAt: TODAY_MS };
    const out = withReceipt(promise);
    expect(out.receipt.source).toBe('capture');
    expect(out.receipt.at).toBeNull();                    // missing date, not a wrong one
    expect(out.receipt.label).toBe('Quoted from your capture');
    expect(out.receipt.label).not.toContain('2026');      // never the import date
  });
});

describe('[RECEIPTS-capture-date Task 2] per-note view derives the conversation date from messages', () => {
  const importedNote = {
    id: 'n1', createdAt: TODAY_MS, // imported today
    messages: [
      { sentAt: '2024-03-14T09:00:00', sender: 'Me', body: 'hi' },
      { sentAt: '2024-03-15T16:00:00', sender: 'Client', body: 'send me the plan' }, // latest = conversation date
    ],
    extracted: {
      promises: [{ text: 'Send the plan', owner: 'client', due_date: null, due_raw: null, confidence: 'high', source_span: 'send me the plan', source_message_at: null }],
      people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
    },
  };

  it('IMPORT GAP: a fact with null message-time renders the latest message date (2024), not the import date', () => {
    const ex = noteWithReceipts(importedNote).extracted as unknown as { promises: Array<{ receipt: { source: string; at: string | null } }> };
    expect(ex.promises[0]!.receipt.source).toBe('capture');
    expect(ex.promises[0]!.receipt.at).toBe('2024-03-15'); // latest message date
    expect(ex.promises[0]!.receipt.at).not.toBe('2026-09-19');
  });

  it('no regression: a voice/paste note (no messages) still falls back to its own capture date', () => {
    const voiceNote = { id: 'n2', createdAt: Date.parse('2026-09-14T08:35:00Z'), messages: null,
      extracted: { promises: [{ text: 'x', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: 'send the quote', source_message_at: null }],
        people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } };
    const ex = noteWithReceipts(voiceNote).extracted as unknown as { promises: Array<{ receipt: { at: string | null } }> };
    expect(ex.promises[0]!.receipt.at).toBe('2026-09-14'); // the note's own capture date, correct for voice/paste
  });
});
