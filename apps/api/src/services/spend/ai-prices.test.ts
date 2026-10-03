import { describe, it, expect } from 'vitest';
import {
  USD_TO_AED,
  AI_PRICES,
  anthropicCostUsd,
  transcriptionCostUsd,
  embeddingCostUsd,
  usdToAed,
  TRANSCRIPTION_MIN_SECONDS,
} from './ai-prices.js';

// [USAGE-ALLOWANCE · D2] The ONE price table, in USD, each row carrying its source URL + the date it was
// checked. The exact-cost function must turn a provider's REAL returned usage into an exact AED cost —
// unit-tested here against the real response shapes (a cache-cold and a fully cache-warm Anthropic call,
// a Groq transcription by duration, an embedding).

describe('[USAGE-ALLOWANCE] every price row records its source and the date checked (D2)', () => {
  it('every Anthropic / transcription / embedding row has a source URL and an ISO date', () => {
    const rows = [
      ...Object.values(AI_PRICES.anthropic),
      ...Object.values(AI_PRICES.transcription),
      AI_PRICES.embedding.titanV2,
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.source, 'a price row is missing its source URL').toMatch(/^https?:\/\//);
      expect(r.checkedOn, 'a price row is missing its checked-on date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('the AED peg is the fixed dirham rate', () => {
    expect(USD_TO_AED).toBe(3.6725);
    expect(usdToAed(10)).toBeCloseTo(36.725, 6);
  });
});

describe('[USAGE-ALLOWANCE] Anthropic exact cost from real usage shapes', () => {
  // A CACHE-COLD Sonnet call: it WRITES the big prefix to cache this call.
  it('prices a cache-cold call (cache write) exactly', () => {
    const usd = anthropicCostUsd('claude-sonnet-5', {
      inputTokens: 200, outputTokens: 800, cacheCreationInputTokens: 5000, cacheReadInputTokens: 0,
    });
    // (200*2 + 800*10 + 5000*4 + 0) / 1e6
    expect(usd).toBeCloseTo(0.0284, 10);
  });

  // The SAME call once the cache is WARM: it READS the prefix at 0.1x instead of writing at 2x.
  it('prices a fully cache-warm call exactly, and it is cheaper than the cold one', () => {
    const warm = anthropicCostUsd('claude-sonnet-5', {
      inputTokens: 200, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 5000,
    });
    // (200*2 + 800*10 + 0 + 5000*0.2) / 1e6
    expect(warm).toBeCloseTo(0.0094, 10);
    const cold = anthropicCostUsd('claude-sonnet-5', {
      inputTokens: 200, outputTokens: 800, cacheCreationInputTokens: 5000, cacheReadInputTokens: 0,
    });
    expect(warm).toBeLessThan(cold);
  });

  it('prices Haiku at its own (cheaper) rates', () => {
    const usd = anthropicCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 1000, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    });
    // (1000*1 + 1000*5) / 1e6
    expect(usd).toBeCloseTo(0.006, 10);
  });

  it('falls back to the Sonnet rate for an unknown model (never zero-cost a paid call)', () => {
    const unknown = anthropicCostUsd('some-future-model', { inputTokens: 1000, outputTokens: 0 });
    const sonnet = anthropicCostUsd('claude-sonnet-5', { inputTokens: 1000, outputTokens: 0 });
    expect(unknown).toBe(sonnet);
    expect(unknown).toBeGreaterThan(0);
  });
});

describe('[USAGE-ALLOWANCE] Groq transcription cost by audio duration', () => {
  it('prices whisper-large-v3 by the hour', () => {
    // 120 s at $0.111/hour.
    expect(transcriptionCostUsd('whisper-large-v3', 120)).toBeCloseTo((120 / 3600) * 0.111, 12);
  });

  it('applies the 10-second minimum billing per request', () => {
    const short = transcriptionCostUsd('whisper-large-v3', 3);
    const tenSec = transcriptionCostUsd('whisper-large-v3', 10);
    expect(TRANSCRIPTION_MIN_SECONDS).toBe(10);
    expect(short).toBeCloseTo(tenSec, 12); // billed at the floor, not the true 3 s
  });
});

describe('[USAGE-ALLOWANCE] embedding cost is estimated from input size', () => {
  it('prices a note embed from character length (Titan v2)', () => {
    // 4000 chars -> ceil(4000/4)=1000 tokens, no requirements.
    expect(embeddingCostUsd(4000, 0)).toBeCloseTo((1000 * 0.02) / 1_000_000, 14);
  });
});
