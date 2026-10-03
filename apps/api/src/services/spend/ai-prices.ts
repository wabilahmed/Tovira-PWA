/**
 * [USAGE-ALLOWANCE · D2] The ONE price table for ALL variable AI spend, in USD. Every row records the
 * `source` URL it came from and the `checkedOn` date it was verified, so a stale price is auditable and
 * re-checkable. Costs convert to AED at the fixed dirham peg.
 *
 * Covered: Anthropic (every model + task class — input, cache write, cache read, output, each at its own
 * rate), Groq transcription (by audio duration), and embeddings (Amazon Titan Text Embeddings V2).
 *
 * A note on exactness (see the gate, Task 3):
 *  - Anthropic: cost is EXACT, computed from the provider's returned token usage.
 *  - Groq transcription: cost is by audio DURATION. The provider returns the exact duration under
 *    verbose_json; the pre-call estimate derives duration from the recording's byte length at the pinned
 *    96 kbps (≈ VOICE_BYTES_PER_SECOND), which over-estimates slightly so the estimate is never below the
 *    settle.
 *  - Embeddings: the embedder returns only a vector (no token count), so embedding cost is ESTIMATED from
 *    input character length and is provably tiny (a whole-transcript embed is capped at 8192 tokens).
 */

/** The UAE dirham is pegged to the USD at a fixed rate. Source: UAE Central Bank peg (AED 3.6725/USD). */
export const USD_TO_AED = 3.6725;
export const USD_TO_AED_SOURCE = {
  source: 'https://www.centralbank.ae/en/our-operations/monetary-operations/',
  checkedOn: '2026-10-03',
};

export function usdToAed(usd: number): number {
  return usd * USD_TO_AED;
}

export interface AnthropicPriceRow {
  inputPerMTok: number;
  outputPerMTok: number;
  /** 1-hour cache-write tier = 2x input (every caching path in this codebase passes ttl '1h'). */
  cacheWritePerMTok: number;
  /** cache read = 0.1x input. */
  cacheReadPerMTok: number;
  source: string;
  checkedOn: string;
}

export interface TranscriptionPriceRow {
  perHourUsd: number;
  source: string;
  checkedOn: string;
}

export interface EmbeddingPriceRow {
  perMTokUsd: number;
  maxInputTokens: number;
  source: string;
  checkedOn: string;
}

const ANTHROPIC_SOURCE = { source: 'https://www.anthropic.com/pricing', checkedOn: '2026-10-03' };
const GROQ_SOURCE = { source: 'https://groq.com/pricing', checkedOn: '2026-10-03' };

/**
 * The canonical price table. Model keys MUST match the ids the adapters report (ports/model.ts,
 * config.groqModel) so a lookup never silently misses.
 */
export const AI_PRICES = {
  anthropic: {
    // Claude Sonnet 5: $2 in / $10 out; cache read $0.20 (0.1x), 1h cache write $4.00 (2x).
    'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 4, cacheReadPerMTok: 0.2, ...ANTHROPIC_SOURCE },
    // Claude Haiku 4.5: $1 in / $5 out; cache read $0.10 (0.1x), 1h cache write $2.00 (2x).
    'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 2, cacheReadPerMTok: 0.1, ...ANTHROPIC_SOURCE },
  } as Record<string, AnthropicPriceRow>,
  transcription: {
    // Groq Whisper Large V3: $0.111/hour. Turbo (distilled) is $0.04/hour. 10-second minimum per request.
    'whisper-large-v3': { perHourUsd: 0.111, ...GROQ_SOURCE },
    'whisper-large-v3-turbo': { perHourUsd: 0.04, ...GROQ_SOURCE },
  } as Record<string, TranscriptionPriceRow>,
  embedding: {
    // Amazon Titan Text Embeddings V2 — list price per MTok, with its input cap.
    titanV2: { perMTokUsd: 0.02, maxInputTokens: 8192, source: 'https://aws.amazon.com/bedrock/pricing/', checkedOn: '2026-10-03' } as EmbeddingPriceRow,
  },
} as const;

/** Groq bills a 10-second minimum per transcription request. */
export const TRANSCRIPTION_MIN_SECONDS = 10;

/** The recorder pins audioBitsPerSecond = 96 kbps (apps/web recorder.ts), so one audio second ≈ 12000
 *  bytes. Used to DERIVE a worst-case duration for the pre-call estimate; the settle uses the provider's
 *  exact returned duration. Deriving high (container overhead inflates bytes/second) keeps estimate ≥ actual. */
export const VOICE_BYTES_PER_SECOND = 96_000 / 8;

const ANTHROPIC_FALLBACK: AnthropicPriceRow = AI_PRICES.anthropic['claude-sonnet-5']!;

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Exact USD cost of one Anthropic call from its returned token usage. Unknown model → the Sonnet rate
 *  (the most expensive of our models), so an unpriced model is never free. */
export function anthropicCostUsd(model: string, u: AnthropicUsage): number {
  const p = AI_PRICES.anthropic[model] ?? ANTHROPIC_FALLBACK;
  return (
    (u.inputTokens * p.inputPerMTok +
      u.outputTokens * p.outputPerMTok +
      (u.cacheCreationInputTokens ?? 0) * p.cacheWritePerMTok +
      (u.cacheReadInputTokens ?? 0) * p.cacheReadPerMTok) /
    1_000_000
  );
}

/** USD cost of one transcription request by audio duration (seconds), with the 10-second floor. Unknown
 *  model → the most expensive transcription rate, so an unpriced model is never free. */
export function transcriptionCostUsd(model: string, durationSeconds: number): number {
  const row = AI_PRICES.transcription[model] ?? mostExpensiveTranscription();
  const billed = Math.max(TRANSCRIPTION_MIN_SECONDS, Math.max(0, durationSeconds));
  return (billed / 3600) * row.perHourUsd;
}

function mostExpensiveTranscription(): TranscriptionPriceRow {
  return Object.values(AI_PRICES.transcription).reduce((a, b) => (b.perHourUsd > a.perHourUsd ? b : a));
}

/** Estimated USD cost of embedding: one note embed (token-capped) plus N short requirement embeds. */
export function embeddingCostUsd(noteChars: number, requirementCount: number): number {
  const row = AI_PRICES.embedding.titanV2;
  const noteTok = Math.min(Math.ceil(Math.max(0, noteChars) / 4), row.maxInputTokens);
  const reqTok = Math.max(0, requirementCount) * 24; // a short requirement clause
  return ((noteTok + reqTok) * row.perMTokUsd) / 1_000_000;
}

/** Worst-case audio duration (seconds) for a recording of `bytes`, for the pre-call transcription estimate. */
export function estimateAudioSeconds(bytes: number): number {
  return Math.max(0, bytes) / VOICE_BYTES_PER_SECOND;
}
