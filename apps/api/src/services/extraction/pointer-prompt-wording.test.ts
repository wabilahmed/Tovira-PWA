import { describe, it, expect } from 'vitest';
import { POINTER_SYSTEM_PROMPT } from './pointer-prompt.js';
import { CERT_SURFACE, NARROW_SURFACE } from '../../eval/extraction-fingerprint.js';

// [P42-B6] Owner: the "next opportunity" after a won deal is any further purchase, not a property. The pointer
// prompt is its own call (not the certified extraction prompt) and sits on neither gate surface.
describe('[P42-B6] pointer prompt wording', () => {
  it('a won deal\'s next opportunity is "a referral, a further purchase, or a renewal"', () => {
    expect(POINTER_SYSTEM_PROMPT).toContain('DEAL STATE won -> section "next_opportunity": a referral, a further purchase, or a renewal');
  });
  it('NEGATIVE: the pointer prompt never assumes property', () => {
    expect(POINTER_SYSTEM_PROMPT).not.toMatch(/property|villa|listing|viewing/i);
  });
  it('the pointer prompt is on neither the certification nor the narrow gate surface', () => {
    expect(CERT_SURFACE).not.toContain('services/extraction/pointer-prompt.ts');
    expect(NARROW_SURFACE).not.toContain('services/extraction/pointer-prompt.ts');
  });
});
