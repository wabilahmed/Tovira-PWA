import { describe, it, expect } from 'vitest';
import { AI_PRICES, anthropicCostUsd, anthropicEstimateAed, usdToAed } from './ai-prices.js';

/**
 * [P23-A2] Sonnet 5.5 + Haiku 5.5 rates (platform.claude.com/docs/en/about-claude/pricing, checked
 * 2026-10-18), per MTok USD. Cache writes are priced by TIER: 5-minute (1.25x) vs 1-hour (2x) — extraction
 * caches at 1h, so a 1h write must not be billed at the 5m rate. Haiku 5.5 bills the WHOLE request at the
 * higher tier when its prompt (input + cache reads + cache writes) is over 100,000 tokens.
 */
const M = 1_000_000;

describe('[P23-A2] 5.5 price rows', () => {
  it('Sonnet 5.5: $2 in, $10 out, $2.50 5m write, $4 1h write, $0.10 read', () => {
    const p = AI_PRICES.anthropic['claude-sonnet-5-5']!;
    expect([p.inputPerMTok, p.outputPerMTok, p.cacheWrite5mPerMTok, p.cacheWritePerMTok, p.cacheReadPerMTok]).toEqual([2, 10, 2.5, 4, 0.1]);
  });
  it('Haiku 5.5 ≤100k: $0.10 / $0.50 / $0.125 / $0.20 / $0.01; >100k: $0.50 / $2.50 / $0.625 / $1 / $0.05', () => {
    const p = AI_PRICES.anthropic['claude-haiku-5-5']!;
    expect([p.inputPerMTok, p.outputPerMTok, p.cacheWrite5mPerMTok, p.cacheWritePerMTok, p.cacheReadPerMTok]).toEqual([0.1, 0.5, 0.125, 0.2, 0.01]);
    expect(p.longContext?.overPromptTokens).toBe(100_000);
    const l = p.longContext!;
    expect([l.inputPerMTok, l.outputPerMTok, l.cacheWrite5mPerMTok, l.cacheWritePerMTok, l.cacheReadPerMTok]).toEqual([0.5, 2.5, 0.625, 1, 0.05]);
  });
  it('existing rows keep their rates (Sonnet 5 read $0.20, Haiku 4.5 $1/$5)', () => {
    expect(AI_PRICES.anthropic['claude-sonnet-5']!.cacheReadPerMTok).toBe(0.2);
    expect(AI_PRICES.anthropic['claude-sonnet-5']!.cacheWrite5mPerMTok).toBe(2.5);
    expect(AI_PRICES.anthropic['claude-haiku-4-5-20251001']!.inputPerMTok).toBe(1);
  });
});

describe('[P23-A2] exact cost', () => {
  it('Sonnet 5.5 warm extraction: 1h-cached prefix read + small input + output', () => {
    const usd = anthropicCostUsd('claude-sonnet-5-5', { inputTokens: 3000, outputTokens: 2000, cacheReadInputTokens: 9000 });
    expect(usd).toBeCloseTo((3000 * 2 + 2000 * 10 + 9000 * 0.1) / M, 12);
  });
  it('a 5-minute cache write is billed at the 5m rate, the rest of the write at the 1h rate', () => {
    const usd = anthropicCostUsd('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 10_000, cacheCreation5mInputTokens: 4_000 });
    expect(usd).toBeCloseTo((4_000 * 2.5 + 6_000 * 4) / M, 12);
  });
  it('a write with no tier breakdown is billed at the 1h rate (what extraction uses; never under-bills)', () => {
    expect(anthropicCostUsd('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 1000 })).toBeCloseTo(1000 * 4 / M, 12);
  });
  it('Haiku 5.5 at exactly 100,000 prompt tokens stays on the base tier', () => {
    const usd = anthropicCostUsd('claude-haiku-5-5', { inputTokens: 60_000, outputTokens: 100, cacheReadInputTokens: 40_000 });
    expect(usd).toBeCloseTo((60_000 * 0.1 + 100 * 0.5 + 40_000 * 0.01) / M, 12);
  });
  it('Haiku 5.5 over 100,000 prompt tokens (cache reads count) bills EVERYTHING at the long tier', () => {
    const usd = anthropicCostUsd('claude-haiku-5-5', { inputTokens: 60_000, outputTokens: 100, cacheReadInputTokens: 40_001 });
    expect(usd).toBeCloseTo((60_000 * 0.5 + 100 * 2.5 + 40_001 * 0.05) / M, 12);
  });
  it('the reserve estimate never falls below the exact cost, on both Haiku 5.5 tiers', () => {
    const small = { system: 'S'.repeat(2_000), messages: [{ role: 'user' as const, content: 'x'.repeat(10_000) }], maxTokens: 512 };
    const exactSmall = anthropicCostUsd('claude-haiku-5-5', { inputTokens: 12_000, outputTokens: 512 });
    expect(anthropicEstimateAed('claude-haiku-5-5', small)).toBeGreaterThanOrEqual(usdToAed(exactSmall));
    const big = { system: 'S', messages: [{ role: 'user' as const, content: 'x'.repeat(150_000) }], maxTokens: 512 };
    const exactBig = anthropicCostUsd('claude-haiku-5-5', { inputTokens: 150_001, outputTokens: 512 });
    expect(anthropicEstimateAed('claude-haiku-5-5', big)).toBeGreaterThanOrEqual(usdToAed(exactBig));
  });
});
