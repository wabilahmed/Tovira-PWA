import { describe, it, expect } from 'vitest';
import { buildReceipt, withReceipt, withExtractedReceipt, NO_RECEIPT_LABEL } from './receipt.js';

const CAPTURE_MS = Date.parse('2026-09-14T08:35:00Z'); // → capture date 2026-09-14

describe('[RECEIPTS-v0.9.5 Task 3] buildReceipt — renders from stored fields only', () => {
  it('imported-chat fact: shows the verbatim span and its per-message time', () => {
    const r = buildReceipt({ sourceSpan: "I'll send the quote Thursday", sourceMessageAt: '2026-09-14T10:01:00Z', captureDateMs: CAPTURE_MS });
    expect(r.source).toBe('message');
    expect(r.quote).toBe("I'll send the quote Thursday");
    expect(r.at).toBe('2026-09-14T10:01:00Z');
    expect(r.label).toBe("I'll send the quote Thursday");
  });

  it('voice/paste fact (null message time): capture-date fallback, clearly not a per-message time', () => {
    const r = buildReceipt({ sourceSpan: 'send the quote Thursday', sourceMessageAt: null, captureDateMs: CAPTURE_MS });
    expect(r.source).toBe('capture');
    expect(r.quote).toBe('send the quote Thursday');
    expect(r.at).toBe('2026-09-14'); // date only
    expect(r.label).toBe('Quoted from your capture on 2026-09-14');
    expect(r.label).not.toMatch(/\d\d:\d\d/); // never a clock time
  });

  it('DECOUPLING: renders correctly with no note body available — it never needs raw_text', () => {
    // The renderer takes only the stored fields; there is no raw_text parameter to pass or omit.
    // Proven concretely at the note surface in receipt-render.integration.test.ts (raw_text deleted).
    const r = buildReceipt({ sourceSpan: 'the handover is on 3 March 2027', sourceMessageAt: null, captureDateMs: CAPTURE_MS });
    expect(r.quote).toBe('the handover is on 3 March 2027');
    expect(r.source).toBe('capture');
  });

  it('never blanks and never fabricates a time when the capture date is also unknown', () => {
    const r = buildReceipt({ sourceSpan: 'meet Thursday', sourceMessageAt: null, captureDateMs: null });
    expect(r.quote).toBe('meet Thursday');
    expect(r.source).toBe('capture');
    expect(r.at).toBeNull();
    expect(r.label).toBe('Quoted from your capture');
  });

  it('no stored span → honest no-receipt marker, driven by span IS NULL (Task 4 branch)', () => {
    for (const span of [null, '', '   ']) {
      const r = buildReceipt({ sourceSpan: span, sourceMessageAt: null, captureDateMs: CAPTURE_MS });
      expect(r.source).toBe('none');
      expect(r.quote).toBeNull();
      expect(r.label).toBe(NO_RECEIPT_LABEL);
    }
  });
});

describe('[RECEIPTS-v0.9.5 Task 3] withReceipt / withExtractedReceipt', () => {
  it('withReceipt uses a relational record’s denormalised captureAt (the conversation date)', () => {
    const rec = { id: 'p1', sourceSpan: 'send the quote', sourceMessageAt: null, captureAt: '2026-09-14', createdAt: CAPTURE_MS };
    const out = withReceipt(rec);
    expect(out.receipt.source).toBe('capture');
    expect(out.receipt.at).toBe('2026-09-14');
    expect(out.id).toBe('p1'); // record preserved
  });

  it('withExtractedReceipt takes the capture date from the originating note', () => {
    const person = { name: 'Omar', source_span: '[T1] Omar: any update?', source_message_at: '2026-09-14T09:20:00Z' };
    const out = withExtractedReceipt(person, CAPTURE_MS);
    expect(out.receipt.source).toBe('message');
    expect(out.receipt.quote).toBe('[T1] Omar: any update?');
    expect(out.name).toBe('Omar');
  });
});
