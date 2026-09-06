import type { RecallDailyCounter } from '../../ports/recall-daily-counter.js';

export interface RecallGateResult {
  allowed: boolean;
  /** Present when refused — the reason, so the surface can show honest, non-punitive copy. */
  reason?: 'daily_cap';
}

/**
 * [SPEND-CAP] Recall's behaviour at the cap (Wabil's ruling): recall KEEPS WORKING at the spend cap
 * (it is interactive — a deferred answer is a non-answer — and already runs on the cheap model), but
 * is limited to N/day WHILE OVER THE CAP. The limit is set from the abuse case (~5× the heaviest
 * plausible day), not the cap, so a legitimate rep never sees it; and it applies ONLY at the cap, so
 * recall is never quietly metered for everyone. It does double duty as the bug-case guard: a runaway
 * loop is stopped in the hour, which a monthly spend cap cannot manage.
 */
export class RecallSpendGate {
  constructor(
    private readonly spend: { canSpend(userId: string): Promise<boolean> },
    private readonly counter: RecallDailyCounter,
    private readonly dailyLimit: number,
  ) {}

  /** `day` is a YYYY-MM-DD string. Under the cap → always allowed, never metered. */
  async check(userId: string, day: string): Promise<RecallGateResult> {
    if (await this.spend.canSpend(userId)) return { allowed: true };
    // Over the cap: meter recall per day and refuse past the limit.
    const count = await this.counter.increment(userId, day);
    return count <= this.dailyLimit ? { allowed: true } : { allowed: false, reason: 'daily_cap' };
  }
}
