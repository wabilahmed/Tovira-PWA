import type { AllowanceStatus } from './allowanceClient.js';

/**
 * [P37 → P83 · owner, 21 Nov] One place for the usage copy (Settings → Subscription, the Today banner, the tour, the
 * processing card), so they never disagree. Messages are the only currency here: no AED, no percentage. Prices live
 * only on the purchase screen (purchaseCopy.ts).
 */

/** "1,500". */
export const groupNumber = (n: number): string => n.toLocaleString('en-US');

/** "5 Dec" from the reset ISO date: the day it is for the rep, in their own time zone [P84-8 · owner] (UTC when none). */
export function resetDay(iso: string | null, timeZone?: string | null): string {
  if (!iso) return 'your next billing month';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'your next billing month';
  const day = (tz: string): string => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).formatToParts(d);
    return `${parts.find((p) => p.type === 'day')!.value} ${parts.find((p) => p.type === 'month')!.value}`;
  };
  try { return day(timeZone || 'UTC'); } catch { return day('UTC'); }
}

/** [P84-5] A trial reads in trial words (it ends; it does not reset). */
const isTrial = (s: Pick<AllowanceStatus, 'trial' | 'subscription'>): boolean => s.trial ?? s.subscription === 'trialing';

/** Whole messages read as a share of what this month has (for the bar's width only, never shown as a number). */
export function fractionRead(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal' | 'exhausted'>): number {
  if (s.exhausted) return 1;
  return s.messagesTotal > 0 ? Math.min(1, s.messagesUsed / s.messagesTotal) : 1;
}

type Who = Partial<Pick<AllowanceStatus, 'trial' | 'subscription' | 'timeZone'>>;

/** "2,340 of 10,000 messages read this month · resets 5 Dec"; a trial: "2,340 of 5,000 trial messages read · trial ends 30 Nov" */
export function usedLine(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal' | 'resetAt'> & Who): string {
  if (isTrial(s)) return `${groupNumber(s.messagesUsed)} of ${groupNumber(s.messagesTotal)} trial messages read · trial ends ${resetDay(s.resetAt, s.timeZone)}`;
  return `${groupNumber(s.messagesUsed)} of ${groupNumber(s.messagesTotal)} messages read this month · resets ${resetDay(s.resetAt, s.timeZone)}`;
}

/** The owner's run-out line: "You've read your 10,000 messages this month. Resets 5 Dec." */
export function runOutLine(s: Pick<AllowanceStatus, 'messagesAllowance' | 'resetAt'> & Who): string {
  return `You've read your ${groupNumber(s.messagesAllowance)} messages this month. Resets ${resetDay(s.resetAt, s.timeZone)}.`;
}

/** The 80 / 95% line: "You've read 8,000 of your 10,000 messages this month." */
export function warnMessage(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal'> & Who): string {
  if (isTrial(s)) return `You've read ${groupNumber(s.messagesUsed)} of your ${groupNumber(s.messagesTotal)} trial messages.`;
  return `You've read ${groupNumber(s.messagesUsed)} of your ${groupNumber(s.messagesTotal)} messages this month.`;
}

/** "Extra messages: 1,500 left (never expire)" */
export function extraLine(packMessagesLeft: number): string {
  return `Extra messages: ${groupNumber(packMessagesLeft)} left (never expire)`;
}

/** "+1,500 messages added" */
export function addedLine(messages: number): string {
  return `+${groupNumber(messages)} messages added`;
}

/** What the run-out message offers, from the real subscription state. */
export type ExhaustedAction = 'buy' | 'subscribe' | 'update_card';
export function exhaustedAction(s: Pick<AllowanceStatus, 'canTopUp' | 'subscription'>): ExhaustedAction {
  if (s.canTopUp) return 'buy';
  if (s.subscription === 'payment_failed' || s.subscription === 'past_due' || s.subscription === 'suspended') return 'update_card';
  return 'subscribe';
}

/** The run-out message, as the server behaves: imports pause; notes, voice notes, the book, Find, briefs already made
 *  and exporting your data keep working. A subscriber is offered the packs (named by their messages) and "Choose your
 *  own amount"; a trial subscribes; a failed payment updates the card. */
export function exhaustedMessage(s: Pick<AllowanceStatus, 'canTopUp' | 'subscription' | 'messagesAllowance' | 'resetAt' | 'messagesExhausted'> & Who): string {
  switch (exhaustedAction(s)) {
    case 'subscribe':
      return s.subscription === 'trialing'
        ? `You've read your ${groupNumber(s.messagesAllowance)} trial messages. Subscribe to keep importing.`
        : 'Your plan has ended. Subscribe to keep importing.';
    case 'update_card':
      return 'Your last payment failed, so importing is paused. Update your card to keep going.';
    default:
      return s.messagesExhausted === false
        ? `Importing is paused until ${resetDay(s.resetAt, s.timeZone)}. Add more messages to keep going now.`
        : runOutLine(s);
  }
}

/** The packs as every surface but the purchase screen names them: "+1,500 messages" (no price). */
export const CHOOSE_OWN = 'Choose your own amount';
