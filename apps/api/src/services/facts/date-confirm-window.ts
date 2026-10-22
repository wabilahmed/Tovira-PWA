/**
 * [P40-1 · owner] A "date to confirm" gets a question card only while its source message is recent: within the
 * last 90 days (by calendar day, inclusive). Older items keep the "Date to confirm" label but get no card, so a
 * long imported history never floods Needs your answer.
 */
export const DATE_CARD_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export function withinDateCardWindow(saidAt: string | number | null | undefined, nowMs: number, days = DATE_CARD_WINDOW_DAYS): boolean {
  if (saidAt === null || saidAt === undefined) return false;
  const said = typeof saidAt === 'number' ? new Date(saidAt).toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.exec(saidAt)?.[0] ?? null;
  if (!said) return false;
  const oldest = new Date(nowMs - days * DAY_MS).toISOString().slice(0, 10);
  return said >= oldest;
}
