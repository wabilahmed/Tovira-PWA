/**
 * [COST-IMPORT-METRIC] Per-import Claude+embedding cost, measured not modelled. A chat import is
 * exactly ONE extraction call over the whole transcript (notes-routes → one note → one extract),
 * so its cost is dominated by the transcript as UNCACHED input — unlike a daily note, where the
 * cached prefix dominates. This makes import cost the one case worth metering per-rep: it is the
 * heaviest single Claude call the product makes, and the unit a cost ceiling would actually bind on.
 *
 * Same shape as [[RecallMetrics]]: pure storage + aggregation over a rolling window; the caller
 * computes the AED (callCostUsd + embed estimate → AED) and passes a finished import.
 */
export interface ImportCostRecord {
  userId: string;
  clientId: string;
  /** Extraction model calls this import made (1, or 2 on a single malformed-output retry). */
  calls: number;
  inputTokens: number; // fresh (uncached) transcript input — the cost driver
  outputTokens: number;
  cachedTokens: number; // prefix served warm (cache-read, ~0.1x)
  cacheWriteTokens: number; // prefix written cold (cache-create, ~2x) — 0 when warm
  embeddingCalls: number; // 1 note embed + N requirement embeds (Titan)
  costAed: number; // extraction + embedding, in AED
}

interface Stored extends ImportCostRecord {
  at: number;
}

export class ImportCostMetrics {
  private events: Stored[] = [];

  constructor(
    private readonly windowMs = 60 * 60 * 1000, // rolling 1h, like the recall + cache registries
    private readonly now: () => number = () => Date.now(),
  ) {}

  record(r: ImportCostRecord): void {
    this.events.push({ ...r, at: this.now() });
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    if (this.events.length && this.events[0]!.at < cutoff) {
      this.events = this.events.filter((e) => e.at >= cutoff);
    }
  }

  private live(): Stored[] {
    const cutoff = this.now() - this.windowMs;
    return this.events.filter((e) => e.at >= cutoff);
  }

  /** Rolling import spend for one rep, in AED. */
  perUserRollingAed(userId: string): number {
    return round(this.live().filter((e) => e.userId === userId).reduce((s, e) => s + e.costAed, 0));
  }

  /** Rolling import spend across all reps, in AED. */
  totalRollingAed(): number {
    return round(this.live().reduce((s, e) => s + e.costAed, 0));
  }

  /** Compact snapshot for the cost surface / /health, beside `recall`. */
  snapshot(): { imports: number; totalAed: number; avgAed: number; totalUncachedInputTokens: number } {
    const live = this.live();
    const total = live.reduce((s, e) => s + e.costAed, 0);
    return {
      imports: live.length,
      totalAed: round(total),
      avgAed: live.length ? round(total / live.length) : 0,
      totalUncachedInputTokens: live.reduce((s, e) => s + e.inputTokens, 0),
    };
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
