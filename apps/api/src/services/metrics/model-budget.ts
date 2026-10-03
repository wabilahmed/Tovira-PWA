/**
 * TEST-BUDGET: cost discipline for any batch that calls a real model. Estimate before,
 * track during (abort if actual exceeds the estimate by more than a margin), report
 * after — actual tokens + cost split cached vs uncached, per task class.
 *
 * [USAGE-ALLOWANCE] Prices now live in ONE table — `services/spend/ai-prices.ts` (D2, with source + date
 * per row). This module re-exports the Anthropic view of that table and delegates cost maths to it, so
 * there is a single source of truth for every rate.
 */
import { AI_PRICES, USD_TO_AED as PEG, anthropicCostUsd, embeddingCostUsd, type AnthropicUsage } from '../spend/ai-prices.js';

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number; // 1-hour tier = 2x input
  cacheReadPerMTok: number; // 0.1x input
}

/** The Anthropic rates, viewed as the legacy shape (source/checkedOn stripped). Single source: AI_PRICES. */
export const PRICING: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(AI_PRICES.anthropic).map(([k, p]) => [
    k,
    { inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok, cacheWritePerMTok: p.cacheWritePerMTok, cacheReadPerMTok: p.cacheReadPerMTok },
  ]),
);
export const USD_TO_AED = PEG;

/** Amazon Titan Text Embeddings V2 — list price (USD per MTok) and its input cap (from AI_PRICES). */
export const EMBED_PRICING = { titanV2PerMTok: AI_PRICES.embedding.titanV2.perMTokUsd, maxInputTokens: AI_PRICES.embedding.titanV2.maxInputTokens };

/** Estimated embedding cost of one import: one note embed (capped) + N short requirement embeds. */
export function estimateEmbedUsd(noteChars: number, requirementCount: number): number {
  return embeddingCostUsd(noteChars, requirementCount);
}

export type CallUsage = AnthropicUsage;

interface Acc {
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function callCostUsd(model: string, u: CallUsage): number {
  return anthropicCostUsd(model, u);
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
