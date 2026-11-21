import type { AllowanceStatus } from './allowanceClient.js';

/**
 * [P37 → P83 · owner, 21 Nov] One place for the usage copy (Settings → Subscription, the Today banner, the tour, the
 * processing card), so they never disagree. Messages are the only currency here: no AED, no percentage. Prices live
 * only on the purchase screen (purchaseCopy.ts).
 */

/** "1,500". */
export const groupNumber = (n: number): string => n.toLocaleString('en-US');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Dec" from the reset ISO date (UTC day, as the server's window). */
export function resetDay(iso: string | null): string {
  if (!iso) return 'your next billing month';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'your next billing month' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Whole messages read as a share of what this month has (for the bar's width only, never shown as a number). */
export function fractionRead(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal' | 'exhausted'>): number {
  if (s.exhausted) return 1;
  return s.messagesTotal > 0 ? Math.min(1, s.messagesUsed / s.messagesTotal) : 1;
}

/** "2,340 of 10,000 messages read this month · resets 5 Dec" */
export function usedLine(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal' | 'resetAt'>): string {
  return `${groupNumber(s.messagesUsed)} of ${groupNumber(s.messagesTotal)} messages read this month · resets ${resetDay(s.resetAt)}`;
}

/** The owner's run-out line: "You've read your 10,000 messages this month. Resets 5 Dec." */
export function runOutLine(s: Pick<AllowanceStatus, 'messagesAllowance' | 'resetAt'>): string {
  return `You've read your ${groupNumber(s.messagesAllowance)} messages this month. Resets ${resetDay(s.resetAt)}.`;
}

/** The 80 / 95% line: "You've read 8,000 of your 10,000 messages this month." */
export function warnMessage(s: Pick<AllowanceStatus, 'messagesUsed' | 'messagesTotal'>): string {
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
export function exhaustedMessage(s: Pick<AllowanceStatus, 'canTopUp' | 'subscription' | 'messagesAllowance' | 'resetAt' | 'messagesExhausted'>): string {
  switch (exhaustedAction(s)) {
    case 'subscribe':
      return s.subscription === 'trialing'
        ? "You've read this trial's messages. Subscribe to keep importing."
        : 'Your plan has ended. Subscribe to keep importing.';
    case 'update_card':
      return 'Your last payment failed, so importing is paused. Update your card to keep going.';
    default:
      return s.messagesExhausted === false
        ? `Importing is paused until ${resetDay(s.resetAt)}. Add more messages to keep going now.`
        : runOutLine(s);
  }
}

/** The packs as every surface but the purchase screen names them: "+1,500 messages" (no price). */
export const CHOOSE_OWN = 'Choose your own amount';
