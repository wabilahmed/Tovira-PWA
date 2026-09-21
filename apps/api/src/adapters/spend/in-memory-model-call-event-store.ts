import type { ModelCallEvent, ModelCallEventStore, ClassAggregate, ModelAggregate, ConversationTurnRow } from '../../ports/model-call-event-store.js';
import type { SpendClass } from '../../ports/spend-ledger-repository.js';
import { USD_TO_AED } from '../../services/metrics/model-budget.js';

/** In-memory per-call event store (tests + local). Aggregation is a straight group-by over events. */
export class InMemoryModelCallEventStore implements ModelCallEventStore {
  private readonly events: ModelCallEvent[] = [];

  async record(e: ModelCallEvent): Promise<void> {
    this.events.push({ ...e });
  }

  private inWindow(fromMs: number, toMs: number, userId?: string): ModelCallEvent[] {
    return this.events.filter((e) => e.at >= fromMs && e.at < toMs && (userId === undefined || e.userId === userId));
  }

  async aggregateByClass(fromMs: number, toMs: number, userId?: string): Promise<ClassAggregate[]> {
    const by = new Map<SpendClass, ClassAggregate>();
    for (const e of this.inWindow(fromMs, toMs, userId)) {
      const a = by.get(e.spendClass) ?? { spendClass: e.spendClass, calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costAed: 0 };
      a.calls += 1;
      a.inputTokens += e.inputTokens;
      a.outputTokens += e.outputTokens;
      a.thinkingTokens += e.thinkingTokens;
      a.cacheReadTokens += e.cacheReadTokens;
      a.cacheCreationTokens += e.cacheCreationTokens;
      a.costAed += e.costAed;
      by.set(e.spendClass, a);
    }
    return [...by.values()].sort((x, y) => y.costAed - x.costAed);
  }

  async aggregateByModel(fromMs: number, toMs: number, userId?: string): Promise<ModelAggregate[]> {
    const by = new Map<string, ModelAggregate>();
    for (const e of this.inWindow(fromMs, toMs, userId)) {
      const a = by.get(e.model) ?? { model: e.model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, costAed: 0 };
      a.calls += 1;
      a.inputTokens += e.inputTokens;
      a.outputTokens += e.outputTokens;
      a.cacheReadTokens += e.cacheReadTokens;
      a.cacheCreationTokens += e.cacheCreationTokens;
      a.costAed += e.costAed;
      by.set(e.model, a);
    }
    for (const a of by.values()) a.costUsd = Math.round((a.costAed / USD_TO_AED) * 1e6) / 1e6;
    return [...by.values()].sort((x, y) => y.costAed - x.costAed);
  }

  async conversationTurns(userId: string, conversationId: string): Promise<ConversationTurnRow[]> {
    const turns = this.events
      .filter((e) => e.userId === userId && e.conversationId === conversationId)
      .sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0) || a.at - b.at);
    let cumulative = 0;
    return turns.map((e) => {
      cumulative = round(cumulative + e.costAed);
      return {
        turnIndex: e.turnIndex ?? 0,
        contextTokens: e.inputTokens + e.cacheReadTokens,
        inputTokens: e.inputTokens,
        cacheReadTokens: e.cacheReadTokens,
        outputTokens: e.outputTokens,
        costAed: e.costAed,
        cumulativeCostAed: cumulative,
        at: e.at,
      };
    });
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
