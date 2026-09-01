/**
 * TEST-BUDGET: cost discipline for any batch that calls a real model. Estimate before,
 * track during (abort if actual exceeds the estimate by more than a margin), report
 * after — actual tokens + cost split cached vs uncached, per task class.
 *
 * Prices are USD per million tokens (approximate list prices; override for accuracy).
 * Cache reads are ~0.1x input; the 1h-TTL write premium is ~2x input.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number; // 1h tier ≈ 2x input
  cacheReadPerMTok: number; // ≈ 0.1x input
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 6, cacheReadPerMTok: 0.3 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 2, cacheReadPerMTok: 0.1 },
};
const FALLBACK: ModelPricing = PRICING['claude-sonnet-5']!;
export const USD_TO_AED = 3.6725;

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
