import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse, ModelUsage } from '../../ports/model.js';
import { modelMetrics, type ModelMetricsRegistry } from '../../services/metrics/model-metrics.js';
import { isSpendClass, type SpendClass } from '../../ports/spend-ledger-repository.js';

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

/** [SPEND-INSTRUMENT] The durable PER-CALL event sink (class/model/tokens/cache/cost), alongside the
 *  ledger. Records rep AND system calls (system → userId null). Set once at boot; unset in tests/eval. */
export interface ModelCallEventSink {
  record(userId: string | null, spendClass: SpendClass, model: string, usage: ModelUsage): Promise<void>;
}
let eventSink: ModelCallEventSink | undefined;
export function setModelCallEventSink(sink: ModelCallEventSink | undefined): void {
  eventSink = sink;
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
    if (res.usage) {
      const cls = request.spendClass;
      // [SPEND-INSTRUMENT] Unclassified spend is IMPOSSIBLE. A rep call (has userId) MUST declare a class,
      // and any class given must be valid. This throws (NOT swallowed) — a new call site without a class
      // breaks loudly in dev/CI, it never silently records nothing (the old bug) or defaults to "other".
      if (request.userId && !cls) throw new Error('[spend] rep model call has no spendClass — unclassified spend is not allowed');
      if (cls !== undefined && !isSpendClass(cls)) throw new Error(`[spend] invalid spendClass "${cls}" — not one of the closed SPEND_CLASSES set`);
      if (cls !== undefined) {
        // Per-call event log — records rep AND system calls (system → userId null, charged to no account).
        if (eventSink) {
          try { await eventSink.record(request.userId ?? null, cls, this.modelId, res.usage); }
          catch (err) { console.warn('[spend] event record failed', err); }
        }
        // Ledger (canSpend) — rep-attributed calls only (a system call never touches a rep's cap).
        if (spendSink && request.userId) {
          try { await spendSink.record(request.userId, cls, this.modelId, res.usage); }
          catch (err) { console.warn('[spend] record failed', err); }
        }
      }
    }
    return res;
  }
}
