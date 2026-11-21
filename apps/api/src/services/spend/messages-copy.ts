import { groupNumber } from '../../config.js';

/**
 * [P83 · owner, 21 Nov] The rep-facing messages lines, server side (the import refusals, WhatsApp replies). Messages are
 * the only currency a rep sees: no AED, no cost.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Dec" (UTC day). */
export function resetDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "You've read your 10,000 messages this month. Resets 5 Dec." */
export function runOutLine(monthlyMessages: number, resetAtMs: number): string {
  return `You've read your ${groupNumber(monthlyMessages)} messages this month. Resets ${resetDay(resetAtMs)}.`;
}
/** "This chat has 1,240 messages to read. You have 500 left this month." */
export function notEnoughLine(toRead: number, left: number, chats = 1): string {
  const what = chats === 1 ? 'This chat has' : `These ${chats} chats have`;
  return `${what} ${groupNumber(toRead)} ${toRead === 1 ? 'message' : 'messages'} to read. You have ${groupNumber(left)} left this month.`;
}
/** What to do next: add messages (a subscriber) or subscribe (a trial). */
export const ADD_MESSAGES_LINE = 'Add more messages to import it now.';
