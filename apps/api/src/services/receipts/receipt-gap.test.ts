import { describe, it, expect } from 'vitest';
import { buildReceipt, noteWithReceipts, NO_RECEIPT_LABEL } from './receipt.js';

/**
 * [RECEIPTS-v0.9.5 Task 4] Honest gaps for pre-v0.9.5 facts. Every fact captured before v0.9.5
 * go-live has source_span NULL and cannot be reconstructed. Such a fact must render a CLEAR
 * no-receipt marker — never a blank that looks like a receipted fact, never a fabricated quote.
 * The marker is driven by `source_span IS NULL`, NOT by any date, so it stays correct for any
 * future fact that also lacks a span.
 */

const RECENT_MS = Date.parse('2026-12-01T09:00:00Z'); // well after go-live — proves the marker is span-driven, not date-driven

describe('[RECEIPTS-v0.9.5 Task 4] pre-v0.9.5 / span-less facts render an honest marker', () => {
  it('a null-span fact renders the no-receipt marker (driven by span, not date)', () => {
    const r = buildReceipt({ sourceSpan: null, sourceMessageAt: null, captureDateMs: RECENT_MS });
    expect(r.source).toBe('none');
    expect(r.quote).toBeNull();
    expect(r.label).toBe(NO_RECEIPT_LABEL);
  });

  it('is span-driven, not date-driven: a RECENT fact with no span is still "none" (not assumed receipted)', () => {
    // Even with a fresh capture date, the absence of a span is what determines the marker.
    const recentNoSpan = buildReceipt({ sourceSpan: null, sourceMessageAt: null, captureDateMs: RECENT_MS });
    expect(recentNoSpan.source).toBe('none');
    // And a fact WITH a span is receipted regardless of how old its date is.
    const oldWithSpan = buildReceipt({ sourceSpan: 'send the quote', sourceMessageAt: null, captureDateMs: Date.parse('2020-01-01T00:00:00Z') });
    expect(oldWithSpan.source).toBe('capture');
  });

  it('a receipted and a non-receipted fact are visually distinguishable', () => {
    const receipted = buildReceipt({ sourceSpan: 'send the quote Thursday', sourceMessageAt: '2026-09-14T10:01:00Z', captureDateMs: RECENT_MS });
    const gap = buildReceipt({ sourceSpan: null, sourceMessageAt: null, captureDateMs: RECENT_MS });
    // Distinguishable on every field a UI would key off:
    expect(receipted.source).not.toBe(gap.source);          // 'message' vs 'none'
    expect(receipted.quote).not.toBeNull();
    expect(gap.quote).toBeNull();
    expect(receipted.label).not.toBe(gap.label);
    expect(gap.label).toBe(NO_RECEIPT_LABEL);
  });

  it('renders the marker end-to-end through a note: mixed receipted + gap facts stay distinguishable', () => {
    const note = {
      id: 'n1', createdAt: RECENT_MS, rawText: 'x',
      extracted: {
        promises: [
          { text: 'A', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: "I'll do A", source_message_at: null }, // receipted
          { text: 'B', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: null, source_message_at: null }, // pre-v0.9.5 gap
        ],
        people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
      },
    };
    const ex = noteWithReceipts(note).extracted as unknown as { promises: Array<{ receipt: { source: string; quote: string | null; label: string } }> };
    expect(ex.promises[0]!.receipt.source).toBe('capture'); // has a span
    expect(ex.promises[1]!.receipt.source).toBe('none');    // gap
    expect(ex.promises[0]!.receipt.source).not.toBe(ex.promises[1]!.receipt.source);
    expect(ex.promises[1]!.receipt.label).toBe(NO_RECEIPT_LABEL);
  });
});
