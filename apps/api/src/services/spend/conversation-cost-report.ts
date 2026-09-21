import type { ModelCallEventStore, ConversationTurnRow } from '../../ports/model-call-event-store.js';

/**
 * [SPEND-INSTRUMENT · ASK-CONVO B4] Per-turn cost growth for ONE conversation, read from the durable
 * per-call log — never recomputed. Answers "what did this 20-turn conversation cost" (the total) and
 * "how does per-turn cost grow as context accretes" (the curve: turn number, context size, cost).
 *
 * The growth story lives in `contextTokens` (the context the model saw that turn = fresh input +
 * cache-read): it climbs as the verbatim history window fills, then plateaus once the window is full
 * (history is a fixed-size window, not an ever-growing transcript). `total` is the whole conversation.
 */
export interface ConversationCostReport {
  conversationId: string;
  turns: ConversationTurnRow[];
  total: { turns: number; costAed: number };
}

export async function conversationCostReport(
  store: ModelCallEventStore,
  userId: string,
  conversationId: string,
): Promise<ConversationCostReport> {
  const turns = await store.conversationTurns(userId, conversationId);
  const costAed = Math.round(turns.reduce((s, t) => s + t.costAed, 0) * 1e6) / 1e6;
  return { conversationId, turns, total: { turns: turns.length, costAed } };
}
