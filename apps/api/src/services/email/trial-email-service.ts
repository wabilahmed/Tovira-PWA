import type { SubscriptionRepository } from '../../ports/billing.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The email surface the trial job needs (both idempotent, one per user). */
export interface TrialEmailer {
  sendTrialEnding(userId: string, to: string, trialEndsAt: number): Promise<boolean>;
  sendTrialEnded(userId: string, to: string): Promise<boolean>;
}

/**
 * The trial-ending / trial-ended job (feat(EMAIL-HOOKS) 1a). Runs daily on the
 * scheduled-job seam. For each trialing account:
 *  - ~2 days before the end → one trial-ending email (the conversion moment);
 *  - on/after the end → one trial-ended email.
 * Both are idempotent per user (the email log), so a re-run, a restart, or a
 * trial extension never double-sends: at most one trial-ending email per trial,
 * against whatever the end date is when it enters the window. A send that throws
 * is isolated per user — one bad address never stops the rest.
 */
export class TrialEmailService {
  constructor(
    private readonly subs: Pick<SubscriptionRepository, 'listTrialing'>,
    private readonly emailFor: (userId: string) => Promise<string | null>,
    private readonly email: TrialEmailer,
  ) {}

  async run(nowMs: number): Promise<{ ending: number; ended: number }> {
    let ending = 0;
    let ended = 0;
    for (const { userId, trialEndsAt } of await this.subs.listTrialing()) {
      try {
        const to = await this.emailFor(userId);
        if (!to) continue;
        const untilEnd = trialEndsAt - nowMs;
        if (untilEnd <= 0) {
          if (await this.email.sendTrialEnded(userId, to)) ended += 1;
        } else if (untilEnd >= 1.5 * DAY_MS && untilEnd <= 2.5 * DAY_MS) {
          if (await this.email.sendTrialEnding(userId, to, trialEndsAt)) ending += 1;
        }
      } catch (err) {
        console.warn(`[trial-email] failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ending, ended };
  }
}
