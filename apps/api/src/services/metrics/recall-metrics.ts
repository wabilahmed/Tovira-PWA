/**
 * [RECALL-METRICS] Per-turn recall cost, measured not guessed. Recall used to DISCARD its
 * usage entirely — no cost was visible at all. Each Ask turn records its shape so the cost
 * curve (and any growth once conversations exist, ASK-CONVO) is observable, and so a rolling
 * per-rep recall spend can sit beside the other cost surfaces.
 *
 * Pure storage + aggregation over a rolling window; the caller computes cost (callCostUsd →
 * AED) and passes a finished turn. Today every turn is turnIndex 1 (Ask is single-shot); the
 * turnIndex/historyTokens fields exist so the conversation window populates them unchanged.
 */
export interface RecallTurn {
  userId: string;
  /** 1-based position within the rep's conversation (always 1 while Ask is single-shot). */
  turnIndex: number;
  retrievalTokens: number; // the top-k excerpts sent this turn
  historyTokens: number; // prior conversation turns re-sent (0 until ASK-CONVO)
  inputTokens: number; // fresh (uncached) input billed at full rate
  outputTokens: number;
  cachedTokens: number; // cache-read input (billed ~0.1x)
  costAed: number;
}

interface Stored extends RecallTurn {
  at: number;
}

export interface TurnBucket {
  calls: number;
  avgRetrievalTokens: number;
  avgHistoryTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostAed: number;
}

export class RecallMetrics {
  private events: Stored[] = [];

  constructor(
    private readonly windowMs = 60 * 60 * 1000, // rolling 1h, like the cache registry
    private readonly now: () => number = () => Date.now(),
  ) {}

  record(turn: RecallTurn): void {
    this.events.push({ ...turn, at: this.now() });
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

  /** Rolling recall spend for one rep, in AED. */
  perUserRollingAed(userId: string): number {
    return round(this.live().filter((e) => e.userId === userId).reduce((s, e) => s + e.costAed, 0));
  }

  /** Rolling recall spend across all reps, in AED. */
  totalRollingAed(): number {
    return round(this.live().reduce((s, e) => s + e.costAed, 0));
  }

  /** The growth curve: averages bucketed by turn index (turn 1 vs 5 vs 15…). */
  curve(): Record<number, TurnBucket> {
    const byTurn = new Map<number, Stored[]>();
    for (const e of this.live()) {
      const arr = byTurn.get(e.turnIndex) ?? [];
      arr.push(e);
      byTurn.set(e.turnIndex, arr);
    }
    const out: Record<number, TurnBucket> = {};
    for (const [turn, evs] of byTurn) {
      const n = evs.length;
      out[turn] = {
        calls: n,
        avgRetrievalTokens: round(evs.reduce((s, e) => s + e.retrievalTokens, 0) / n),
        avgHistoryTokens: round(evs.reduce((s, e) => s + e.historyTokens, 0) / n),
        avgInputTokens: round(evs.reduce((s, e) => s + e.inputTokens, 0) / n),
        avgOutputTokens: round(evs.reduce((s, e) => s + e.outputTokens, 0) / n),
        avgCostAed: round(evs.reduce((s, e) => s + e.costAed, 0) / n),
      };
    }
    return out;
  }

  /** Compact snapshot for the cost surface / /health. */
  snapshot(): { turns: number; totalAed: number; curve: Record<number, TurnBucket> } {
    return { turns: this.live().length, totalAed: this.totalRollingAed(), curve: this.curve() };
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
