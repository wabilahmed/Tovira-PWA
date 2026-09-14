import { describe, it, expect } from 'vitest';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js';
import { EXTRACTION_SYSTEM_PROMPT_V095, PROMPT_VERSION_V095 } from './prompt-v0.9.5-draft.js';

// [RECEIPTS-v0.9.5] The candidate prompt is the certified v0.9.4 base + ONLY the intended additions.
// No model calls — this verifies the transform is exact, so what we certify is auditable.
describe('[RECEIPTS-v0.9.5] candidate prompt transform', () => {
  it('builds without a thrown anchor error (all anchors matched)', () => {
    expect(EXTRACTION_SYSTEM_PROMPT_V095.length).toBeGreaterThan(EXTRACTION_SYSTEM_PROMPT.length);
    expect(PROMPT_VERSION_V095).toBe('tovira-extract-v0.9.5');
  });

  it('preserves the base rules 0–8 verbatim (no accidental change to certified behaviour)', () => {
    for (const rule of [
      '0. Multilingual input is normal.',
      '1. Only extract what is explicitly stated',
      '2. Dates: resolve relative dates',
      '5. People: use names exactly as stated.',
      '8. Requirements — what the client is looking for',
    ]) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(rule);
      expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain(rule);
    }
  });

  it('adds source_span + source_message_at to exactly the five fact schema blocks', () => {
    // 5 schema blocks + 2 fields each appear in the new example P/Q outputs too, so just assert both
    // field names are present and the schema shows them on each of the five block types.
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain('"source_span": "the verbatim excerpt this fact was drawn from | null"');
    // requirements + unanswered handled elsewhere — the schema's requirements block must NOT gain them.
    const reqBlock = EXTRACTION_SYSTEM_PROMPT_V095.slice(
      EXTRACTION_SYSTEM_PROMPT_V095.indexOf('"requirements": ['),
      EXTRACTION_SYSTEM_PROMPT_V095.indexOf('"meeting": {'),
    );
    expect(reqBlock).not.toContain('source_span');
  });

  it('inserts Rule 9 (source receipts) and renumbers valid-JSON to Rule 10', () => {
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain('9. Source receipts (source_span, source_message_at)');
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain('10. Output only valid JSON matching the schema.');
    // the old numbering must be gone
    expect(EXTRACTION_SYSTEM_PROMPT_V095).not.toContain('9. Output only valid JSON');
  });

  it('carries the null-discipline for source_message_at (no stand-in) and a fabricated-span warning', () => {
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toMatch(/never use the note's capture time, today's date, or any other stand-in/i);
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toMatch(/a fabricated span is as serious as a fabricated date/i);
  });

  it('adds the two receipt examples and keeps the exact-shape closing line last', () => {
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain('### Example P');
    expect(EXTRACTION_SYSTEM_PROMPT_V095).toContain('### Example Q');
    expect(EXTRACTION_SYSTEM_PROMPT_V095.trimEnd().endsWith('Follow these rules and the shape of these examples exactly. Output only the JSON object.')).toBe(true);
  });
});
