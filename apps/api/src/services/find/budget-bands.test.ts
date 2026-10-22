import { describe, it, expect } from 'vitest';
import { BUDGET_BANDS } from './find-service.js';

/** [P40-3 · owner] under AED 1M · AED 1–2M · AED 2–5M · AED 5–10M · over AED 10M (only bands with clients are shown). */
describe('[P40-3] budget bands', () => {
  it('the five bands, in order, with their labels', () => {
    expect(BUDGET_BANDS.map((b) => [b.value, b.label])).toEqual([
      ['under-1m', 'Under AED 1M'], ['1m-2m', 'AED 1–2M'], ['2m-5m', 'AED 2–5M'], ['5m-10m', 'AED 5–10M'], ['over-10m', 'Over AED 10M'],
    ]);
  });
  it('they tile the range with no gap and no overlap', () => {
    for (let i = 1; i < BUDGET_BANDS.length; i++) expect(BUDGET_BANDS[i]!.min).toBe(BUDGET_BANDS[i - 1]!.max);
    expect(BUDGET_BANDS[0]!.min).toBe(0);
    expect(BUDGET_BANDS.at(-1)!.max).toBe(Infinity);
  });
});
