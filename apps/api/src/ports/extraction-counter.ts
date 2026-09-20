/**
 * [TRIAL-FARM] Durable, monotonic per-account extraction counter, bucketed by billing period.
 *
 * Replaces the old ceiling input (a COUNT of hot `extraction_logs` rows), which archival or a
 * single-counterparty erasure could LOWER — turning the cap into a suggestion. This counter is a
 * dedicated record that ONLY ever increments within a (user, period) bucket: training-archival and
 * erasure never touch it. It is purged only on FULL account deletion (privacy), where the account —
 * and any farming value — is gone anyway.
 *
 * `periodKey` is the rep's billing-period key (see periodKeyFrom): a trial is one stable `t:<end>`
 * bucket (so the trial ceiling bounds the whole trial), a paid sub is a per-period `p:<start>` bucket
 * (so the paid ceiling resets each period and never locks out a long-term customer).
 */
export interface ExtractionCounterRepository {
  /** Increment (user, period) by one. Monotonic — there is no decrement. */
  increment(userId: string, periodKey: string): Promise<void>;
  /** The current count in (user, period). Zero if none. */
  count(userId: string, periodKey: string): Promise<number>;
  /** Full-account-deletion purge (privacy). NOT called by erasure or archival. */
  purgeUser(userId: string): Promise<void>;
}
