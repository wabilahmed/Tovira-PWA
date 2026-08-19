import { describe, it, expect } from 'vitest';
import { adviseCache, simulateTier, MIN_SAMPLE, type CacheEvent } from './cache-advisor.js';

const MIN = 60_000;
const P = 6744; // prefix tokens

/** Build N events spaced `gapMin` minutes apart, each a hit (read) by default so
 *  derivePrefixTokens sees a real size; the advisor re-simulates from the times. */
function series(n: number, gapMin: number, startAt = 1_000_000_000): CacheEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    at: startAt + i * gapMin * MIN,
    cacheCreationTokens: i === 0 ? P : 0,
    cacheReadTokens: i === 0 ? 0 : P,
  }));
}

describe('simulateTier', () => {
  it('all gaps < 5m → one write then all reads (both tiers stay warm)', () => {
    const times = series(10, 1).map((e) => e.at); // 1-min gaps
    expect(simulateTier(times, '5m', P)).toMatchObject({ writes: 1, reads: 9 });
    expect(simulateTier(times, '1h', P)).toMatchObject({ writes: 1, reads: 9 });
  });

  it('gaps in the 5–60min band → 5m re-writes every call, 1h reads them', () => {
    const times = series(10, 20).map((e) => e.at); // 20-min gaps
    expect(simulateTier(times, '5m', P)).toMatchObject({ writes: 10, reads: 0 });
    expect(simulateTier(times, '1h', P)).toMatchObject({ writes: 1, reads: 9 });
  });

  it('gaps > 1h → both tiers write every call', () => {
    const times = series(6, 90).map((e) => e.at); // 90-min gaps
    expect(simulateTier(times, '5m', P)).toMatchObject({ writes: 6, reads: 0 });
    expect(simulateTier(times, '1h', P)).toMatchObject({ writes: 6, reads: 0 });
  });
});

describe('adviseCache', () => {
  it('recommends 1h when calls are spaced 5–60min apart (the sweet spot)', () => {
    const a = adviseCache(series(40, 20), '5m');
    expect(a.recommend).toBe('1h');
    expect(a.switchRecommended).toBe(true);
    expect(a.sim['1h'].costUnits).toBeLessThan(a.sim['5m'].costUnits);
    expect(a.gap.band5to60Pct).toBeGreaterThan(0.9);
    expect(a.estMonthlyUsdSaving).toBeGreaterThan(0);
    // The 1h win is band-driven (fewer writes), and the reason says so.
    expect(a.sim['1h'].writes).toBeLessThan(a.sim['5m'].writes);
    expect(a.reason).toMatch(/5–60min apart/);
  });

  it('recommends 5m for a busy stream (all gaps < 5m) — 1h only overpays on the write', () => {
    const a = adviseCache(series(40, 1), '1h');
    expect(a.recommend).toBe('5m');
    expect(a.switchRecommended).toBe(true); // currently on 1h, should move to 5m
    expect(a.sim['5m'].costUnits).toBeLessThanOrEqual(a.sim['1h'].costUnits);
  });

  it('recommends 5m when calls are hours apart (both write; 1.25× < 2×)', () => {
    const a = adviseCache(series(40, 90), '1h');
    expect(a.recommend).toBe('5m');
    expect(a.sim['5m'].costUnits).toBeLessThan(a.sim['1h'].costUnits);
    // Both tiers write every call — the 5m win is the write premium, NOT the band.
    expect(a.sim['5m'].writes).toBe(a.sim['1h'].writes);
    expect(a.reason).toMatch(/write premium/i);
  });

  it('does NOT recommend a switch on thin data (< MIN_SAMPLE), even if a tier looks cheaper', () => {
    const a = adviseCache(series(MIN_SAMPLE - 1, 20), '5m');
    expect(a.recommend).toBe('1h'); // the cheaper tier is still reported…
    expect(a.switchRecommended).toBe(false); // …but not acted on without signal
    expect(a.reason).toMatch(/keep 5m/i);
  });

  it('no switch when already on the recommended tier', () => {
    const a = adviseCache(series(40, 20), '1h');
    expect(a.recommend).toBe('1h');
    expect(a.switchRecommended).toBe(false);
    expect(a.estMonthlyUsdSaving).toBe(0);
  });

  it('derives the prefix size from observed cache tokens', () => {
    const events = series(30, 20);
    expect(adviseCache(events, '5m').prefixTokens).toBe(P);
  });

  it('falls back to the default prefix size when no cache tokens were recorded (stub)', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ at: i * 20 * MIN, cacheCreationTokens: 0, cacheReadTokens: 0 }));
    expect(adviseCache(events, '5m').prefixTokens).toBeGreaterThan(0);
  });

  it('reports the observed write/read mix as a cross-check on the simulation', () => {
    const a = adviseCache(series(40, 20), '1h');
    expect(a.observed.writes + a.observed.reads + a.observed.uncached).toBe(40);
    expect(a.observed.writes).toBe(1); // series() marks only the first as a write
  });

  it('handles an empty log without throwing', () => {
    const a = adviseCache([], '1h');
    expect(a.calls).toBe(0);
    expect(a.switchRecommended).toBe(false);
  });
});
