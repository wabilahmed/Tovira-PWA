import type { ModelUsage } from '../../ports/model.js';
import type { ModelCallEventStore } from '../../ports/model-call-event-store.js';
import type { SpendClass } from '../../ports/spend-ledger-repository.js';
import { callCostUsd, USD_TO_AED, type CallUsage } from '../metrics/model-budget.js';

/**
 * [SPEND-INSTRUMENT] The per-call event sink. Given a completed metered call, it prices it (the SAME
 * `callCostUsd` the ledger uses), resolves the rep's billing-period bucket (system calls have none), and
 * writes one durable row. Wired to the metered chokepoint via setModelCallEventSink.
 */
export class ModelCallEventService {
  constructor(
    private readonly store: ModelCallEventStore,
    /** The rep's current billing-period key (same bucketing as the ledger). System calls (null user) skip it. */
    private readonly periodKeyFor: (userId: string) => Promise<string>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async record(userId: string | null, spendClass: SpendClass, model: string, usage: ModelUsage, attribution?: { conversationId?: string; turnIndex?: number }): Promise<void> {
    const callUsage: CallUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
    };
    const costAed = callCostUsd(model, callUsage) * USD_TO_AED;
    const periodKey = userId ? await this.periodKeyFor(userId) : null;
    await this.store.record({
      userId,
      periodKey,
      spendClass,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thinkingTokens: usage.thinkingTokens ?? 0,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
      cacheHit: (usage.cacheReadInputTokens ?? 0) > 0,
      costAed,
      at: this.now(),
      conversationId: attribution?.conversationId ?? null,
      turnIndex: attribution?.turnIndex ?? null,
    });
  }
}
