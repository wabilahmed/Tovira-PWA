/**
 * CACHE-1: per-task-class prompt-cache observability. This exists because the cache
 * problem went unnoticed — nothing reported the hit rate. The metric here is
 * deliberately hits ÷ CACHEABLE calls (a call that requested a cached prefix), NOT
 * hits ÷ total input tokens — the latter is the misleading ratio (dominated by
 * inherently-variable note/recall/brief input) that made a healthy cache look 9%.
 * A class that never requests caching (its prompt is below the model minimum, e.g.
 * the Haiku classes) reports `n/a — below minimum`, never 0%, so a correct path is
 * never mistaken for a failure.
 */
export interface ClassCacheStats {
  model: string;
  calls: number;
  cacheableCalls: number;
  hits: number;
  /** "NN%" over cacheable calls, or "n/a — below minimum" when none are cacheable. */
  hitRate: string;
}

interface CallEvent {
  at: number;
  cacheable: boolean;
  hit: boolean;
}

export const NA_BELOW_MIN = 'n/a — below minimum';

export class ModelMetricsRegistry {
  private readonly byClass = new Map<string, { model: string; events: CallEvent[] }>();
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: { windowMs?: number; now?: () => number } = {}) {
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000; // rolling 1h
    this.now = opts.now ?? (() => Date.now());
  }

  /** Record one completed model call. `cacheable` = it requested a cached prefix;
   *  `hit` = the API reported a cache read (>0 read tokens). */
  record(taskClass: string, model: string, ev: { cacheable: boolean; hit: boolean }): void {
    const entry = this.byClass.get(taskClass) ?? { model, events: [] };
    entry.model = model;
    entry.events.push({ at: this.now(), cacheable: ev.cacheable, hit: ev.hit });
    const cutoff = this.now() - this.windowMs;
    entry.events = entry.events.filter((e) => e.at >= cutoff);
    this.byClass.set(taskClass, entry);
  }

  /** Per-class rolling snapshot for /health. */
  snapshot(): Record<string, ClassCacheStats> {
    const cutoff = this.now() - this.windowMs;
    const out: Record<string, ClassCacheStats> = {};
    for (const [cls, entry] of this.byClass) {
      const evs = entry.events.filter((e) => e.at >= cutoff);
      const cacheableCalls = evs.filter((e) => e.cacheable).length;
      const hits = evs.filter((e) => e.cacheable && e.hit).length;
      out[cls] = {
        model: entry.model,
        calls: evs.length,
        cacheableCalls,
        hits,
        hitRate: cacheableCalls === 0 ? NA_BELOW_MIN : `${Math.round((hits / cacheableCalls) * 100)}%`,
      };
    }
    return out;
  }
}

/** Process-global registry: model clients record here; /health reads it. */
export const modelMetrics = new ModelMetricsRegistry();
