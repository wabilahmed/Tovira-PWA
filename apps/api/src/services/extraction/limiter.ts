/**
 * [TRIAL-FARM] Extraction ceiling — enforced server-side, BEFORE the model call.
 *
 * Two changes from the original P5-1 limiter:
 *  1. DURABLE counter. The bound is read from a dedicated monotonic counter (per user, per billing
 *     period), never from a count of hot `extraction_logs` rows that archival or a single-counterparty
 *     erasure could lower. A cap that shrinks when logs are pruned is a suggestion, not a cap.
 *  2. POST-TRIAL scope. A trial has a TIGHT ceiling (`trial`); a paying account (active/past_due) has
 *     a far more generous PER-PERIOD ceiling (`paid`) — a card + real accountability — that resets each
 *     billing period so it never locks out a long-term customer. "Generous" is not "no ceiling at all":
 *     it is a runaway-loop backstop above what the AED spend cap allows.
 *
 * `record()` is called once per extraction that actually spends (a model call was made), so the
 * counter reflects real spend, not retries or gated no-ops.
 */

export interface ExtractionLimiter {
  /** May this account extract now? False → defer (note stays pending), never a model call. */
  allow(userId: string): Promise<boolean>;
  /** Count one extraction that spent. Optional so a trivial limiter need not implement it. */
  record?(userId: string): Promise<void>;
}

/** How the limiter learns the account's billing status + period bucket (see periodKeyFrom). */
export type EntitlementResolver = (userId: string, nowMs: number) => Promise<{ status: string; periodKey: string }>;

export interface ExtractionCeilings {
  /** Per-trial-window ceiling (tight — a trialing account). */
  trial: number;
  /** Per-billing-period ceiling for a paying account (active/past_due) — generous, resets each period. */
  paid: number;
}

export class TrialExtractionLimiter implements ExtractionLimiter {
  constructor(
    private readonly resolve: EntitlementResolver,
    private readonly counter: { count(userId: string, periodKey: string): Promise<number>; increment(userId: string, periodKey: string): Promise<void> },
    private readonly ceilings: ExtractionCeilings,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** A paying account (has a card) gets the generous ceiling; everyone else (trialing, expired,
   *  canceled, none) gets the tight trial ceiling — no account extracts more than a trial's worth
   *  without paying. */
  private ceilingFor(status: string): number {
    return status === 'active' || status === 'past_due' ? this.ceilings.paid : this.ceilings.trial;
  }

  async allow(userId: string): Promise<boolean> {
    const { status, periodKey } = await this.resolve(userId, this.now());
    const used = await this.counter.count(userId, periodKey);
    return used < this.ceilingFor(status);
  }

  async record(userId: string): Promise<void> {
    const { periodKey } = await this.resolve(userId, this.now());
    await this.counter.increment(userId, periodKey);
  }
}
