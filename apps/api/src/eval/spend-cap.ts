import { anthropicCostUsd, anthropicEstimateAed, usdToAed, type AnthropicUsage } from '../services/spend/ai-prices.js';
import type { ModelCompletionRequest } from '../ports/model.js';

export class SpendCapExceeded extends Error {}
/** [P83-9] A run refused before it started: its worst case would pass the cap. Nothing was sent. */
export class RunOverCap extends Error {}

/** [P83-9] One call a run will make: its whole input (chars, each counted as a token: a true ceiling) and its output
 *  ceiling (max_tokens, thinking included). */
export interface PlannedCall { inputChars: number; maxOutputTokens: number }

/** [P83-9] The worst-case AED of one call, from the shared price table: every input char priced as a cache-WRITING
 *  token (the highest input-side rate, so a cold call is covered; the long-context tier when the chars cross it) plus
 *  the output ceiling at the output rate. Batch half price only when `batch`. Never below what the call can cost. */
export function worstCaseCallAed(model: string, call: PlannedCall, opts: { batch: boolean }): number {
  return usdToAed(anthropicCostUsd(model, { inputTokens: 0, cacheCreationInputTokens: call.inputChars, outputTokens: call.maxOutputTokens, batchDiscount: opts.batch }));
}

/** [P83-9] The worst-case AED of a whole run: every call at its worst case. */
export function worstCaseRunAed(model: string, calls: PlannedCall[], opts: { batch: boolean }): number {
  return calls.reduce((n, c) => n + worstCaseCallAed(model, c, opts), 0);
}

/** [P83-9] A raw Messages API body as a planned call: its system, messages (and tools) text as input, its max_tokens
 *  as the output ceiling (`fallbackMaxTokens` when the body sets none). JSON length is at least the text length. */
export function plannedCallOf(body: { system?: unknown; messages?: unknown; tools?: unknown; max_tokens?: unknown }, fallbackMaxTokens: number): PlannedCall {
  const len = (x: unknown): number => (x === undefined ? 0 : typeof x === 'string' ? x.length : JSON.stringify(x).length);
  const max = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : fallbackMaxTokens;
  return { inputChars: len(body.system) + len(body.messages) + len(body.tools), maxOutputTokens: max };
}

/**
 * [P83-9 · owner] A measurement cap is a hard stop: print the run's worst case, and REFUSE to start (throw RunOverCap,
 * `start` never called) when what this round already spent plus that worst case would pass the cap.
 */
export async function startWithinCap<T>(
  opts: { model: string; calls: PlannedCall[]; batch: boolean; spentAed: number; capAed: number; log?: (line: string) => void },
  start: () => Promise<T>,
): Promise<T> {
  const log = opts.log ?? ((l: string) => console.log(l));
  if (!Number.isFinite(opts.capAed) || opts.capAed <= 0) throw new RunOverCap(`the cap must be a positive number of AED, got ${opts.capAed}: nothing sent`);
  const worst = worstCaseRunAed(opts.model, opts.calls, { batch: opts.batch });
  const total = opts.spentAed + worst;
  const line = `${opts.calls.length} call(s) · worst case AED ${worst.toFixed(2)} (${opts.batch ? 'batch half price' : 'live price'}, every call at its output ceiling) · already spent AED ${opts.spentAed.toFixed(2)} · cap AED ${opts.capAed.toFixed(2)}`;
  log(line);
  if (total > opts.capAed) {
    throw new RunOverCap(`refused: AED ${opts.spentAed.toFixed(2)} spent + worst case AED ${worst.toFixed(2)} = AED ${total.toFixed(2)} would pass the cap AED ${opts.capAed.toFixed(2)}. Nothing was sent. Run fewer pieces or runs, or raise the cap.`);
  }
  return start();
}

/**
 * [P23-A3] Hard AED stop for real-model eval runs (GATE_SPEND_CAP_AED). Each call's exact cost — from the
 * provider's returned token counts at that model's real price — is added; once the running total passes
 * the cap the run aborts, reporting where it stopped. Without a cap it only counts. [P83-9] `guard` before each call
 * refuses one whose worst case would pass the cap, so the cap is never crossed.
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

  /** [P83-9] Call BEFORE each live call: refuses (nothing sent) when what is spent plus this call's worst case
   *  (anthropicEstimateAed, the shared price table) would pass the cap, so a capped run can never end above it. */
  guard(model: string, req: ModelCompletionRequest): void {
    if (this.capAed === undefined) return;
    const worst = anthropicEstimateAed(model, req);
    if (this.spentAed + worst > this.capAed) {
      throw new SpendCapExceeded(`spend cap: AED ${this.spentAed.toFixed(2)} spent + this call's worst case AED ${worst.toFixed(2)} would pass the cap AED ${this.capAed.toFixed(2)}. Refused before the call, after ${this.calls} call(s).`);
    }
  }

  add(model: string, usage: AnthropicUsage): void {
    this.spentAed += usdToAed(anthropicCostUsd(model, usage));
    this.calls += 1;
    if (this.capAed !== undefined && this.spentAed > this.capAed) {
      throw new SpendCapExceeded(`spend cap reached: AED ${this.spentAed.toFixed(2)} > cap AED ${this.capAed.toFixed(2)} after ${this.calls} call(s) — run aborted here`);
    }
  }
}
