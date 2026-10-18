import { anthropicCostUsd, usdToAed, type AnthropicUsage } from '../services/spend/ai-prices.js';

export class SpendCapExceeded extends Error {}

/**
 * [P23-A3] Hard AED stop for real-model eval runs (GATE_SPEND_CAP_AED). Each call's exact cost — from the
 * provider's returned token counts at that model's real price — is added; once the running total passes
 * the cap the run aborts, reporting where it stopped. Without a cap it only counts.
 */
export class SpendCap {
  spentAed = 0;
  calls = 0;
  constructor(readonly capAed: number | undefined) {}

  static fromEnv(env: Record<string, string | undefined>): SpendCap {
    const raw = env.GATE_SPEND_CAP_AED?.trim();
    if (!raw) return new SpendCap(undefined);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`GATE_SPEND_CAP_AED must be a positive number of AED, got "${raw}"`);
    return new SpendCap(n);
  }

  add(model: string, usage: AnthropicUsage): void {
    this.spentAed += usdToAed(anthropicCostUsd(model, usage));
    this.calls += 1;
    if (this.capAed !== undefined && this.spentAed > this.capAed) {
      throw new SpendCapExceeded(`spend cap reached: AED ${this.spentAed.toFixed(2)} > cap AED ${this.capAed.toFixed(2)} after ${this.calls} call(s) — run aborted here`);
    }
  }
}
