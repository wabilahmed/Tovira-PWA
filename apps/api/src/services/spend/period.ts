/**
 * [SPEND-CAP · BILLING-PERIOD] The rep's current billing-period key — the spend-cap bucket, so the
 * cap and the invoice describe the same window.
 *
 * The anchor is the Stripe-supplied `periodStart` (`p:<start>`), authoritative and stable across a
 * plan change: when Stripe issues a new period its start changes, so the key changes, the new bucket
 * starts clean, and already-recorded spend stays in the old bucket. We NEVER invent a start. When one
 * is absent we fall back EXPLICITLY to a marked key — trials to `t:<trialEnd>`, an active sub with no
 * stored start to `pf:end:<renewsAt>`, and anything else to a `pf:m:<YYYY-MM>` calendar bucket. The
 * `pf:`/`t:` prefix records, durably in every ledger row, that the bucket is derived, not an
 * authoritative billing period — the same discipline as never showing an invented renewal date.
 */
export interface BillingWindow {
  status: string;
  trialEndsAt: number | null;
  renewsAt: number | null;
  periodStart: number | null;
}

export interface PeriodKey {
  key: string;
  /** True when the bucket is DERIVED (no Stripe-supplied period start), not an authoritative period. */
  fallback: boolean;
}

export function periodKeyFrom(e: BillingWindow, nowMs: number): PeriodKey {
  if (e.status === 'active' && e.periodStart) return { key: `p:${e.periodStart}`, fallback: false };
  if (e.status === 'trialing' && e.trialEndsAt) return { key: `t:${e.trialEndsAt}`, fallback: true }; // trial window, not a paid period
  if (e.status === 'active' && e.renewsAt) return { key: `pf:end:${e.renewsAt}`, fallback: true }; // pre-change sub: anchor off the end
  return { key: `pf:m:${new Date(nowMs).toISOString().slice(0, 7)}`, fallback: true }; // last resort: calendar month
}
