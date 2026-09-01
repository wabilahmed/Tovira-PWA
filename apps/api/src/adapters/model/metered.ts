import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';
import { modelMetrics, type ModelMetricsRegistry } from '../../services/metrics/model-metrics.js';

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
    return res;
  }
}
