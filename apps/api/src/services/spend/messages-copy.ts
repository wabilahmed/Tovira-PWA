import { groupNumber } from '../../config.js';
import { isValidTimeZone } from '../time/zone.js';

/**
 * [P83 · owner, 21 Nov] The rep-facing messages lines, server side (the import refusals, WhatsApp replies). Messages are
 * the only currency a rep sees: no AED, no cost.
 */
/** "5 Dec": the reset instant as the day it is for the rep, in their own time zone [P84-8 · owner] (UTC when none). */
export function resetDay(ms: number, timeZone?: string): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).formatToParts(new Date(ms));
  return `${parts.find((p) => p.type === 'day')!.value} ${parts.find((p) => p.type === 'month')!.value}`;
}
/** "You've read your 10,000 messages this month. Resets 5 Dec." */
export function runOutLine(monthlyMessages: number, resetAtMs: number, timeZone?: string): string {
  return `You've read your ${groupNumber(monthlyMessages)} messages this month. Resets ${resetDay(resetAtMs, timeZone)}.`;
}
/** [P84-5] A trial does not reset: "You've read your 5,000 trial messages." */
export function trialRunOutLine(trialMessages: number): string {
  return `You've read your ${groupNumber(trialMessages)} trial messages.`;
}
/** "This chat has 1,240 messages to read. You have 500 left this month." (a trial: "... left in your trial.") */
export function notEnoughLine(toRead: number, left: number, chats = 1, trial = false): string {
  const what = chats === 1 ? 'This chat has' : `These ${chats} chats have`;
  return `${what} ${groupNumber(toRead)} ${toRead === 1 ? 'message' : 'messages'} to read. You have ${groupNumber(left)} left ${trial ? 'in your trial' : 'this month'}.`;
}
/** What to do next: add messages (a subscriber) or subscribe (a trial). */
export const ADD_MESSAGES_LINE = 'Add more messages to import it now.';
export const SUBSCRIBE_LINE = 'Subscribe to import it now.';
