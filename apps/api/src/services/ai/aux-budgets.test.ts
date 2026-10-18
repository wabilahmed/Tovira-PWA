import { describe, it, expect } from 'vitest';
import { AUX_MAX_TOKENS, TOKENIZER_HEADROOM } from './aux-budgets.js';

/** [P23-A2] Haiku 5.5 counts ~30% more tokens than Haiku 4.5 for the same text, so every aux output
 *  ceiling that was sized on Haiku 4.5 carries that headroom — an answer of the same length still fits. */
describe('[P23-A2] aux max_tokens carry the new-tokenizer headroom', () => {
  const before = { recall: 512, capture: 120, priorities: 256, draft: 512, meeting: 4096 } as const;
  it('headroom is 1.3x', () => expect(TOKENIZER_HEADROOM).toBe(1.3));
  for (const [k, old] of Object.entries(before)) {
    it(`${k}: ${old} → at least ${Math.ceil(old * 1.3)}`, () => expect(AUX_MAX_TOKENS[k as keyof typeof before]).toBeGreaterThanOrEqual(Math.ceil(old * 1.3)));
  }
});
