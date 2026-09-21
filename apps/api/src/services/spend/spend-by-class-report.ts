import type { ModelCallEventStore } from '../../ports/model-call-event-store.js';

/**
 * [SPEND-INSTRUMENT B3] Shape the recorded per-call events into the ops cost readout: cost BY CLASS with
 * each class's share of the total, and cost BY MODEL — the invoice-comparable line (Anthropic bills per
 * model, per token type, in USD, over a calendar window). Reads the stored aggregates; it NEVER
 * recomputes cost (the per-call cost was priced once, at record time, with the same callCostUsd).
 *
 * `userId` given → that ONE account; omitted → every account AND system calls, so the by-model total
 * reconciles directly to the Anthropic invoice for the window.
 */
export interface SpendByClassReport {
  window: { from: string; to: string };
  scope: 'account' | 'all';
  total: { costAed: number; costUsd: number };
  byClass: Array<{ spendClass: string; calls: number; costAed: number; shareOfTotal: number; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number }>;
  /** Invoice-comparable: per model, USD + AED + token breakdown, for the same window. */
  byModel: Array<{ model: string; calls: number; costUsd: number; costAed: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export async function spendByClassReport(store: ModelCallEventStore, fromMs: number, toMs: number, userId?: string): Promise<SpendByClassReport> {
  const [byClass, byModel] = await Promise.all([
    store.aggregateByClass(fromMs, toMs, userId),
    store.aggregateByModel(fromMs, toMs, userId),
  ]);
  const totalAed = byClass.reduce((s, c) => s + c.costAed, 0);
  const totalUsd = byModel.reduce((s, m) => s + m.costUsd, 0);
  return {
    window: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    scope: userId === undefined ? 'all' : 'account',
    total: { costAed: round2(totalAed), costUsd: round2(totalUsd) },
    byClass: byClass.map((c) => ({
      spendClass: c.spendClass,
      calls: c.calls,
      costAed: round2(c.costAed),
      shareOfTotal: totalAed > 0 ? round4(c.costAed / totalAed) : 0,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      thinkingTokens: c.thinkingTokens,
      cacheReadTokens: c.cacheReadTokens,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: m.calls,
      costUsd: round2(m.costUsd), // USD — the currency Anthropic bills in
      costAed: round2(m.costAed),
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheCreationTokens: m.cacheCreationTokens,
    })),
  };
}
