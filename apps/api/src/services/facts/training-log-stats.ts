import type { TrainingLogStats, TrainingLogStatsRepository } from '../../ports/training-log-stats-repository.js';

export interface TrainingLogStatsSnapshot extends TrainingLogStats {
  /** When the cached aggregate was last computed (ms), or null before the first refresh. */
  computedAtMs: number | null;
}

const EMPTY: TrainingLogStatsSnapshot = {
  total: 0, last24h: 0, emptyOutput: 0, corrections: 0, byPromptVersion: {}, computedAtMs: null,
};

/**
 * [TRAINING-METRICS] Caches the training-log aggregate so /health surfaces volume WITHOUT a DB scan
 * on every hit. snapshot() is synchronous and always returns the last computed value instantly (the
 * ALB health check never blocks on the DB); when the value is older than the TTL it kicks off ONE
 * background refresh. So the aggregate query runs at most once per TTL regardless of health-check
 * frequency — cheap aggregates, no per-row scanning per check.
 */
export class TrainingLogStatsService {
  private cache: TrainingLogStatsSnapshot = EMPTY;
  private refreshing = false;

  constructor(
    private readonly repo: TrainingLogStatsRepository,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Instant, non-blocking. Returns the cached aggregate and triggers a throttled background refresh. */
  snapshot(): TrainingLogStatsSnapshot {
    const c = this.cache;
    const stale = c.computedAtMs === null || this.now() - c.computedAtMs >= this.ttlMs;
    if (stale && !this.refreshing) void this.refresh();
    return c;
  }

  /** Recompute the aggregate now. Awaitable (startup warm-up / tests). Never throws. */
  async refresh(): Promise<TrainingLogStatsSnapshot> {
    if (this.refreshing) return this.cache;
    this.refreshing = true;
    try {
      const s = await this.repo.aggregate(this.now());
      this.cache = { ...s, computedAtMs: this.now() };
    } catch (err) {
      console.warn(`[training-stats] aggregate refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.refreshing = false;
    }
    return this.cache;
  }
}
