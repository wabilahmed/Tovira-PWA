import { describe, it, expect } from 'vitest';
import { tallyTier1 } from './tier1-tally.js';

describe('tallyTier1 — Tier-1 backfill compliance count', () => {
  it('counts by type across notes, Luhn-confirming cards, and tallies affected notes', () => {
    const texts = [
      'pay to AE070331234567890123456 and card 4539 1488 0343 6467',   // iban + valid card
      'my EID is 784-1990-1234567-1',                                   // emirates_id
      'we ordered 100000 units at AED 45000, ref ORD-20260901-0042',    // clean — no Tier-1
      'the reference is 1234567812345678',                              // 16 digits, fails Luhn → NOT a card
      '',                                                               // empty note
    ];
    const t = tallyTier1(texts);
    expect(t.byType.iban).toBe(1);
    expect(t.byType.card).toBe(1);          // only the Luhn-valid one
    expect(t.byType.emirates_id).toBe(1);
    expect(t.notesScanned).toBe(5);
    expect(t.notesWithAnyTier1).toBe(2);    // note 1 (iban+card) and note 2 (emirates_id)
    expect(t.total).toBe(3);                // iban + card + emirates_id occurrences
  });

  it('is all-zero on clean input (no false positives)', () => {
    const t = tallyTier1(['met the client', 'ordered 500 units at AED 12000', 'call me on +971 50 123 4567']);
    expect(t.total).toBe(0);
    expect(t.notesWithAnyTier1).toBe(0);
    expect(t.notesScanned).toBe(3);
  });
});
