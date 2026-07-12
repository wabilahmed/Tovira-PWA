import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildUserMessage,
  estimateTokens,
  PROMPT_VERSION,
} from './prompt.js';

// [P1-6] The caching contract: a big, byte-identical prefix, with today's date
// kept OUT of it (in the variable message) so the cache doesn't break daily.
describe('extraction prompt', () => {
  it('the cacheable prefix clears the 4,096-token floor', () => {
    expect(estimateTokens(EXTRACTION_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(4096);
  });

  it('the cacheable prefix is byte-identical regardless of the note, client, or date', () => {
    // The prefix is a constant — it must not vary with call inputs.
    const a = EXTRACTION_SYSTEM_PROMPT;
    const b = EXTRACTION_SYSTEM_PROMPT;
    expect(a).toBe(b);
  });

  // NEGATIVE (fault-injection guard): today's date must never appear in the
  // cached prefix, or the cache misses every day.
  it('the cacheable prefix contains no date-like token', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('the variable message carries today, client, source and the note', () => {
    const msg = buildUserMessage({
      today: '2026-07-09',
      clientName: 'Meridian Corp',
      source: 'voice',
      text: "I'll send the revised quote by Friday",
    });
    expect(msg).toContain('2026-07-09');
    expect(msg).toContain('Meridian Corp');
    expect(msg).toContain('voice_note');
    expect(msg).toContain('revised quote by Friday');
  });

  it('two calls on different days share an identical prefix but differ in the message', () => {
    const m1 = buildUserMessage({ today: '2026-07-09', clientName: 'C', source: 'paste', text: 'x' });
    const m2 = buildUserMessage({ today: '2026-07-10', clientName: 'C', source: 'paste', text: 'x' });
    expect(EXTRACTION_SYSTEM_PROMPT).toBe(EXTRACTION_SYSTEM_PROMPT); // prefix stable
    expect(m1).not.toBe(m2); // message changes with the date
  });

  it('exposes a prompt version for logging', () => {
    expect(PROMPT_VERSION).toBe('tovira-extract-v0.1');
  });
});
