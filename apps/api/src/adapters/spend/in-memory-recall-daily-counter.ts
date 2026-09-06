import type { RecallDailyCounter } from '../../ports/recall-daily-counter.js';

/** In-memory recall daily counter (tests + local). */
export class InMemoryRecallDailyCounter implements RecallDailyCounter {
  private readonly counts = new Map<string, number>();

  async increment(userId: string, day: string): Promise<number> {
    const key = `${userId} ${day}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}
