/**
 * [SPEND-CAP] A per-rep, per-day recall counter — used ONLY while a rep is over the spend cap, to
 * cap recall at N/day (a runaway loop is stopped in the hour, which a monthly spend cap cannot do).
 * Below the cap it is never touched: recall stays unlimited and unmetered for everyone.
 */
export interface RecallDailyCounter {
  /** Increment (rep, day) and return the new count. `day` is a YYYY-MM-DD string. */
  increment(userId: string, day: string): Promise<number>;
}
