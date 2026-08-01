/**
 * Trial seeding bound (P5-1, cost guard #4): a per-trial extraction ceiling,
 * enforced server-side. Generous enough for the Book Scan on several chats, but a
 * hard stop against unbounded burn (e.g. importing 50 chats). Paid accounts are
 * never limited. The route surfaces a clear message when the ceiling is hit.
 */

export interface ExtractionLimiter {
  allow(userId: string): Promise<boolean>;
}

export class TrialExtractionLimiter implements ExtractionLimiter {
  constructor(
    private readonly statusOf: (userId: string, nowMs: number) => Promise<string>,
    private readonly countExtractions: (userId: string) => Promise<number>,
    private readonly ceiling: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async allow(userId: string): Promise<boolean> {
    const status = await this.statusOf(userId, this.now());
    if (status !== 'trialing') return true; // only trials are bounded
    return (await this.countExtractions(userId)) < this.ceiling;
  }
}
