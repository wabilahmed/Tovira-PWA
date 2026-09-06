import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse, ModelUsage } from '../../ports/model.js';
import { modelMetrics, type ModelMetricsRegistry } from '../../services/metrics/model-metrics.js';

/** [SPEND-CAP] Where per-call Claude cost is recorded, attributed to a rep. A module-level sink
 *  (like `modelMetrics`) so every metered client records without threading a service through every
 *  `createModelClient` call. Set once at boot; unset in tests + eval (no attribution → no record). */
export interface SpendSink {
  record(userId: string, spendClass: string, model: string, usage: ModelUsage): Promise<void>;
}
let spendSink: SpendSink | undefined;
export function setSpendSink(sink: SpendSink | undefined): void {
  spendSink = sink;
}

/**
 * CACHE-1: a thin decorator that records every completed model call's cache outcome
 * to the metrics registry, tagged with its task class. `cacheable` = the call asked
 * for a cached prefix; `hit` = the API returned cache-read tokens. Errors pass through
 * unrecorded (a failed call has no cache signal). Transparent otherwise.
 */
export class MeteredModelClient implements ModelClient {
  readonly modelId: string;

  constructor(
    /** The wrapped provider client (exposed for composition-root assertions). */
    readonly inner: ModelClient,
    private readonly taskClass: string,
    modelId: string,
    private readonly registry: ModelMetricsRegistry = modelMetrics,
  ) {
    this.modelId = modelId;
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const res = await this.inner.complete(request);
    this.registry.record(this.taskClass, this.modelId, {
      cacheable: request.cacheSystemPrompt === true,
      hit: (res.usage?.cacheReadInputTokens ?? 0) > 0,
    });
    // [SPEND-CAP] Record this call's AED against the rep's billing period. Best-effort — a spend
    // ledger failure must never break a model call (never lose the work over a bookkeeping error).
    if (spendSink && request.userId && request.spendClass && res.usage) {
      try {
        await spendSink.record(request.userId, request.spendClass, this.modelId, res.usage);
      } catch (err) {
        console.warn('[spend] record failed', err);
      }
    }
    return res;
  }
}
