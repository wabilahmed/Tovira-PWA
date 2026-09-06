/**
 * [SPEND-CAP] The rep's current BILLING-period key — so the spend cap and the invoice describe the
 * same window. Derived from billing entitlement: an active sub buckets by its renewal instant
 * (advances on each invoice → spend resets for the new period); a trial buckets by its end; anything
 * else falls back to the calendar month. (No `current_period_start` is persisted — see the report;
 * the renewal instant is a stable within-period anchor and is sufficient as a bucket key.)
 */
export interface BillingWindow {
  status: string;
  trialEndsAt: number | null;
  renewsAt: number | null;
}

export function periodKeyFrom(e: BillingWindow, nowMs: number): string {
  if (e.status === 'active' && e.renewsAt) return `p:${e.renewsAt}`;
  if (e.status === 'trialing' && e.trialEndsAt) return `t:${e.trialEndsAt}`;
  return `m:${new Date(nowMs).toISOString().slice(0, 7)}`; // YYYY-MM fallback (unbilled / past_due)
}
