/**
 * TEST-BUDGET: cost discipline for any batch that calls a real model. Estimate before,
 * track during (abort if actual exceeds the estimate by more than a margin), report
 * after — actual tokens + cost split cached vs uncached, per task class.
 *
 * Prices are USD per million tokens — Anthropic published first-party rates.
 * Cache reads are 0.1x input; cache writes are 1.25x input (5-minute TTL) or 2x input (1-hour TTL,
 * made permanent 2026-08-10). `cacheWritePerMTok` below is the 1-HOUR rate, because EVERY caching path
 * in this codebase uses ttl '1h' (config.extractionCacheTtl defaults to '1h'; the gate, canary, and
 * erasure resummarise all pass '1h'). If any path is switched to '5m' (EXTRACTION_CACHE_TTL=5m), its
 * writes would bill at 1.25x ($2.50 Sonnet / $1.25 Haiku) but be priced here at the 1h rate — a latent
 * over-count on writes only, which are ~0.1% of spend (one write per warm cache period).
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number; // 1-hour tier = 2x input (see note above)
  cacheReadPerMTok: number; // 0.1x input
}

export const PRICING: Record<string, ModelPricing> = {
  // Claude Sonnet 5: $2 in / $10 out; cache read $0.20 (0.1x), 1h write $4.00 (2x). [5m write would be $2.50.]
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 4, cacheReadPerMTok: 0.2 },
  // Claude Haiku 4.5: $1 in / $5 out; cache read $0.10 (0.1x), 1h write $2.00 (2x). [5m write would be $1.25.]
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 2, cacheReadPerMTok: 0.1 },
};
const FALLBACK: ModelPricing = PRICING['claude-sonnet-5']!;
export const USD_TO_AED = 3.6725;

/** Amazon Titan Text Embeddings V2 — list price (USD per MTok) and its input cap. The embedder
 *  adapter returns only a vector (no token count), so import embedding cost is ESTIMATED from
 *  character length; it is provably negligible (a whole-transcript embed is capped at 8192 tokens). */
export const EMBED_PRICING = { titanV2PerMTok: 0.02, maxInputTokens: 8192 };

/** Estimated embedding cost of one import: one note embed (capped) + N short requirement embeds. */
export function estimateEmbedUsd(noteChars: number, requirementCount: number): number {
  const noteTok = Math.min(Math.ceil(noteChars / 4), EMBED_PRICING.maxInputTokens);
  const reqTok = Math.max(0, requirementCount) * 24; // a short requirement clause
  return ((noteTok + reqTok) * EMBED_PRICING.titanV2PerMTok) / 1_000_000;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

interface Acc {
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function callCostUsd(model: string, u: CallUsage): number {
  const p = PRICING[model] ?? FALLBACK;
  return (
    ((u.inputTokens * p.inputPerMTok) +
      (u.outputTokens * p.outputPerMTok) +
      ((u.cacheCreationInputTokens ?? 0) * p.cacheWritePerMTok) +
      ((u.cacheReadInputTokens ?? 0) * p.cacheReadPerMTok)) /
    1_000_000
  );
}

export class BudgetExceededError extends Error {}

export class ModelBudget {
  private readonly byClass = new Map<string, Acc>();

  constructor(
    /** Estimated ceiling for the batch, in USD. */
    private readonly estimateUsd: number,
    /** Allowed overshoot before aborting, as a fraction (0.25 = 25%). */
    private readonly margin = 0.25,
  ) {}

  record(taskClass: string, model: string, u: CallUsage): void {
    const a = this.byClass.get(taskClass) ?? { model, calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    a.model = model;
    a.calls += 1;
    a.input += u.inputTokens;
    a.output += u.outputTokens;
    a.cacheWrite += u.cacheCreationInputTokens ?? 0;
    a.cacheRead += u.cacheReadInputTokens ?? 0;
    this.byClass.set(taskClass, a);
  }

  totalUsd(): number {
    let sum = 0;
    for (const a of this.byClass.values()) {
      sum += callCostUsd(a.model, { inputTokens: a.input, outputTokens: a.output, cacheCreationInputTokens: a.cacheWrite, cacheReadInputTokens: a.cacheRead });
    }
    return sum;
  }

  /** Abort a batch that has blown past the estimate + margin (call after each unit of work). */
  check(): void {
    const cap = this.estimateUsd * (1 + this.margin);
    if (this.totalUsd() > cap) {
      throw new BudgetExceededError(
        `model spend $${this.totalUsd().toFixed(4)} exceeded budget $${this.estimateUsd.toFixed(4)} + ${Math.round(this.margin * 100)}% margin ($${cap.toFixed(4)}) — aborting`,
      );
    }
  }

  report(): { estimateUsd: number; totalUsd: number; totalAed: number; perClass: Array<{ taskClass: string; model: string; calls: number; cachedTokens: number; uncachedTokens: number; usd: number }> } {
    const perClass = [...this.byClass.entries()].map(([taskClass, a]) => ({
      taskClass,
      model: a.model,
      calls: a.calls,
      cachedTokens: a.cacheRead, // served from cache (cheap)
      uncachedTokens: a.input + a.cacheWrite, // billed at/above input rate
      usd: callCostUsd(a.model, { inputTokens: a.input, outputTokens: a.output, cacheCreationInputTokens: a.cacheWrite, cacheReadInputTokens: a.cacheRead }),
    }));
    const totalUsd = this.totalUsd();
    return { estimateUsd: this.estimateUsd, totalUsd, totalAed: totalUsd * USD_TO_AED, perClass };
  }
}
