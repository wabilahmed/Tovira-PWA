import type { Pool } from 'pg';
import type { ModelCallEvent, ModelCallEventStore, ClassAggregate, ModelAggregate, ConversationTurnRow } from '../../ports/model-call-event-store.js';
import { isSpendClass } from '../../ports/spend-ledger-repository.js';
import { USD_TO_AED } from '../../services/metrics/model-budget.js';

/**
 * [SPEND-INSTRUMENT] Durable per-call event store. Uses the root pool (no RLS): this is cross-tenant cost
 * accounting for OPS, and B3's aggregation reads across all accounts. Writes are append-only (INSERT).
 */
export class PgModelCallEventStore implements ModelCallEventStore {
  constructor(private readonly pool: Pool) {}

  async record(e: ModelCallEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO model_call_events
         (user_id, period_key, spend_class, model, input_tokens, output_tokens, thinking_tokens,
          cache_read_tokens, cache_creation_tokens, cache_hit, cost_aed, conversation_id, turn_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [e.userId, e.periodKey, e.spendClass, e.model, e.inputTokens, e.outputTokens, e.thinkingTokens,
        e.cacheReadTokens, e.cacheCreationTokens, e.cacheHit, e.costAed, e.conversationId ?? null, e.turnIndex ?? null],
    );
  }

  private where(fromMs: number, toMs: number, userId?: string): { clause: string; params: unknown[] } {
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    if (userId === undefined) return { clause: 'created_at >= $1 AND created_at < $2', params: [from, to] };
    return { clause: 'created_at >= $1 AND created_at < $2 AND user_id = $3', params: [from, to, userId] };
  }

  async aggregateByClass(fromMs: number, toMs: number, userId?: string): Promise<ClassAggregate[]> {
    const { clause, params } = this.where(fromMs, toMs, userId);
    const { rows } = await this.pool.query(
      `SELECT spend_class, count(*)::int AS calls,
              sum(input_tokens)::bigint AS input, sum(output_tokens)::bigint AS output,
              sum(thinking_tokens)::bigint AS thinking, sum(cache_read_tokens)::bigint AS cache_read,
              sum(cache_creation_tokens)::bigint AS cache_create, sum(cost_aed) AS cost_aed
         FROM model_call_events WHERE ${clause} GROUP BY spend_class ORDER BY sum(cost_aed) DESC`,
      params,
    );
    return rows
      .filter((r: { spend_class: string }) => isSpendClass(r.spend_class))
      .map((r: Record<string, string>) => ({
        spendClass: r.spend_class as ClassAggregate['spendClass'],
        calls: Number(r.calls), inputTokens: Number(r.input), outputTokens: Number(r.output),
        thinkingTokens: Number(r.thinking), cacheReadTokens: Number(r.cache_read),
        cacheCreationTokens: Number(r.cache_create), costAed: Number(r.cost_aed),
      }));
  }

  async aggregateByModel(fromMs: number, toMs: number, userId?: string): Promise<ModelAggregate[]> {
    const { clause, params } = this.where(fromMs, toMs, userId);
    const { rows } = await this.pool.query(
      `SELECT model, count(*)::int AS calls,
              sum(input_tokens)::bigint AS input, sum(output_tokens)::bigint AS output,
              sum(cache_read_tokens)::bigint AS cache_read, sum(cache_creation_tokens)::bigint AS cache_create,
              sum(cost_aed) AS cost_aed
         FROM model_call_events WHERE ${clause} GROUP BY model ORDER BY sum(cost_aed) DESC`,
      params,
    );
    return rows.map((r: Record<string, string>) => {
      const costAed = Number(r.cost_aed);
      return {
        model: String(r.model), calls: Number(r.calls), inputTokens: Number(r.input), outputTokens: Number(r.output),
        cacheReadTokens: Number(r.cache_read), cacheCreationTokens: Number(r.cache_create),
        costAed, costUsd: Math.round((costAed / USD_TO_AED) * 1e6) / 1e6,
      };
    });
  }

  async conversationTurns(userId: string, conversationId: string): Promise<ConversationTurnRow[]> {
    const { rows } = await this.pool.query(
      `SELECT turn_index, input_tokens, output_tokens, cache_read_tokens, cost_aed,
              extract(epoch from created_at) * 1000 AS at_ms
         FROM model_call_events
        WHERE user_id = $1 AND conversation_id = $2
        ORDER BY turn_index ASC NULLS LAST, created_at ASC`,
      [userId, conversationId],
    );
    let cumulative = 0;
    return rows.map((r: Record<string, string>) => {
      const inputTokens = Number(r.input_tokens);
      const cacheReadTokens = Number(r.cache_read_tokens);
      const costAed = Number(r.cost_aed);
      cumulative = Math.round((cumulative + costAed) * 1e6) / 1e6;
      return {
        turnIndex: Number(r.turn_index), contextTokens: inputTokens + cacheReadTokens,
        inputTokens, cacheReadTokens, outputTokens: Number(r.output_tokens),
        costAed, cumulativeCostAed: cumulative, at: Number(r.at_ms),
      };
    });
  }
}
