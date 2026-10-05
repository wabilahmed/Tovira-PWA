/**
 * [BILLING-DUNNING · D4–D8] The daily failed-payment job's PURE decision: given one account's billing
 * fields and now, what to do today — retry the charge, send a reminder, suspend, end, or (post-end) warn
 * about / perform the 90-day deletion. No Stripe, no DB, no email here — the runner performs the effects.
 */
import type { SubscriptionRecord } from '../../ports/billing.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day boundaries from the first failed charge (D3/D5/D7). */
export const SUSPEND_AFTER_DAYS = 7;   // D5: suspend 7 days after the first failure
export const END_AFTER_DAYS = 30;      // D7: stop retrying + end 30 days after the first failure
/** [D8] How long an ENDED account's data is kept so it can be restored, then deleted. Derivation: long
 *  enough to recover a lapsed card or a holiday; bounded, as counsel requires for retention. OWNER MAY
 *  CHANGE — this is the one tunable constant; it lives here alone so it is a one-line edit. */
export const RETENTION_AFTER_END_DAYS = 90;
export const DELETION_WARN_30D_DAYS = RETENTION_AFTER_END_DAYS - 30; // warn 30 days before deletion
export const DELETION_WARN_7D_DAYS = RETENTION_AFTER_END_DAYS - 7;   // warn 7 days before deletion

export interface DunningAction {
  /** New billing_state to write, if it changes. */
  nextState?: 'suspended' | 'ended';
  /** Attempt the daily app-driven retry (invoices.pay) — at most once per calendar day, never once ended. */
  retry: boolean;
  /** Send today's reminder email + keep the banner. */
  remind: boolean;
}

const daysSince = (fromMs: number, nowMs: number): number => Math.floor((nowMs - fromMs) / DAY_MS);
/** Same UTC calendar day — so retry/remind fire at most once per day regardless of when the job runs. */
const sameUtcDay = (a: number, b: number): boolean => Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS);

/**
 * What the daily job should do for ONE account today. Only runs meaningfully for a running clock
 * (payment_failed/suspended); an active or ended account yields no retry (guard 5).
 */
export function dunningAction(sub: SubscriptionRecord, nowMs: number): DunningAction {
  if (sub.billingState !== 'payment_failed' && sub.billingState !== 'suspended') {
    return { retry: false, remind: false }; // never retry an active or ended account
  }
  if (sub.firstFailedAt === null) return { retry: false, remind: false }; // no clock → nothing
  const days = daysSince(sub.firstFailedAt, nowMs);

  // Day 30: stop retrying and end (D7). No retry today.
  if (days >= END_AFTER_DAYS) return { nextState: 'ended', retry: false, remind: false };

  // Day 7: suspend (D5), but keep retrying + reminding through day 30 (D6).
  const nextState = sub.billingState === 'payment_failed' && days >= SUSPEND_AFTER_DAYS ? 'suspended' : undefined;

  // Retry + remind at most once per UTC day (idempotent if the job runs twice).
  const alreadyToday = sub.lastRetryAt !== null && sameUtcDay(sub.lastRetryAt, nowMs);
  return { ...(nextState ? { nextState } : {}), retry: !alreadyToday, remind: !alreadyToday };
}

/** [D8] For an ENDED account: which deletion step is due today (warn at 60d/83d, delete at 90d). */
export interface RetentionAction {
  warn30d: boolean;
  warn7d: boolean;
  delete: boolean;
}
export function retentionAction(sub: SubscriptionRecord, nowMs: number): RetentionAction {
  if (sub.billingState !== 'ended' || sub.endedAt === null) return { warn30d: false, warn7d: false, delete: false };
  const days = daysSince(sub.endedAt, nowMs);
  return {
    warn30d: days >= DELETION_WARN_30D_DAYS && !sub.deletionWarned30d,
    warn7d: days >= DELETION_WARN_7D_DAYS && !sub.deletionWarned7d,
    delete: days >= RETENTION_AFTER_END_DAYS,
  };
}
