/**
 * [USAGE-ALLOWANCE] The MONTHLY allowance window (D1, D11). The AI allowance (AED 60/month by default —
 * DEFAULT_MONTHLY_AI_ALLOWANCE_AED in config) resets monthly — even for an annual subscriber, who resets on their billing ANCHOR DAY each month
 * (D11), NOT once a year. This is distinct from the spend-cap billing-period key (period.ts), which is
 * the whole Stripe period (a year for annual).
 *
 * The window containing `now` runs [anchor-day this cycle, anchor-day next cycle). The anchor day is the
 * day-of-month of the subscription's period start (or renewal date; else the 1st), clamped to the
 * month's length so a 31st anchor lands on the last day of a short month. A trial is ONE window keyed to
 * its end (D10). Keys are sortable so the ledger can find the previous window to carry top-ups forward.
 */
export interface AllowanceWindowInput {
  status: string;
  trialEndsAt: number | null;
  renewsAt: number | null;
  periodStart: number | null;
}

export interface AllowanceWindow {
  key: string;
  startMs: number;
  endMs: number;
  /** 1-28..31, the day-of-month the allowance resets. null for a trial. */
  anchorDay: number | null;
}

const MONTH_KEY = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

/** The UTC instant of `anchorDay` in year/month0, clamped to the month's real length. */
function anchorInstant(year: number, month0: number, anchorDay: number): number {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return Date.UTC(year, month0, Math.min(anchorDay, lastDay));
}

export function allowanceWindow(w: AllowanceWindowInput, nowMs: number): AllowanceWindow {
  // Trial: the whole trial is one allowance window (D10), keyed to its end.
  if (w.status === 'trialing' && w.trialEndsAt) {
    return { key: `trial:${w.trialEndsAt}`, startMs: w.trialEndsAt - 31 * 24 * 60 * 60 * 1000, endMs: w.trialEndsAt, anchorDay: null };
  }

  // Active (monthly or annual) or fallback: a calendar-ish month anchored on the billing day.
  const anchorSource = w.periodStart ?? w.renewsAt ?? null;
  const anchorDay = anchorSource ? new Date(anchorSource).getUTCDate() : 1;
  const prefix = w.periodStart || w.renewsAt ? 'm' : 'cal';

  const now = new Date(nowMs);
  let y = now.getUTCFullYear();
  let m0 = now.getUTCMonth();
  // Step back to the window whose anchor instant is <= now.
  if (nowMs < anchorInstant(y, m0, anchorDay)) {
    m0 -= 1;
    if (m0 < 0) { m0 = 11; y -= 1; }
  }
  const startMs = anchorInstant(y, m0, anchorDay);
  let ny = y;
  let nm0 = m0 + 1;
  if (nm0 > 11) { nm0 = 0; ny += 1; }
  const endMs = anchorInstant(ny, nm0, anchorDay);

  return { key: `${prefix}:${MONTH_KEY(y, m0)}`, startMs, endMs, anchorDay };
}
