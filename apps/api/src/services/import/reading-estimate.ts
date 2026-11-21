import type { ImportedMessage } from '../../ports/note-repository.js';
import { filterChatter } from './chatter-filter.js';
import { planWindows } from '../extraction/windowed.js';

/**
 * [P82-B · owner, 21 Nov] Messages are the only currency a rep sees, and they are counted STRIPPED: the messages
 * Tovira reads, after the sensitive screen (held messages are never read) and the chatter pre-filter, never the raw
 * export count. Shown before an import: "This chat has 1,240 messages to read. About 3 minutes." No cost, ever.
 *
 * Minutes, measured (19-21 Nov, Sonnet 5, 120-message pieces): live, 4 pieces are read at once and a round takes about
 * 1.7 minutes (8-10 pieces in 3.7-5.8 min); a batched bulk import sends up to 16 pieces per round (4 chats x 4) and a
 * batch round takes about 3 minutes (165-184 s measured).
 */
export const LIVE_LANES = 4;
export const LIVE_MINUTES_PER_ROUND = 1.7;
export const BATCH_PIECES_PER_ROUND = 16;
export const BATCH_MINUTES_PER_ROUND = 3;
const WINDOW = { threshold: 150, size: 120, overlap: 20 };

/** The messages Tovira will read: not held by the screen, and not chatter. */
export function messagesToRead(messages: ImportedMessage[]): number {
  return filterChatter(messages.filter((m) => !m.excluded)).kept.length;
}

export interface ReadingEstimate { messages: number; pieces: number; minutes: number }

export function piecesFor(messages: number): number {
  return messages === 0 ? 0 : (planWindows(messages, WINDOW)?.length ?? 1);
}

export function minutesFor(pieces: number, mode: 'live' | 'batch'): number {
  if (pieces === 0) return 0;
  if (mode === 'batch') return Math.ceil(pieces / BATCH_PIECES_PER_ROUND) * BATCH_MINUTES_PER_ROUND;
  if (pieces === 1) return 1; // one call: about a minute
  return Math.max(1, Math.round(Math.ceil(pieces / LIVE_LANES) * LIVE_MINUTES_PER_ROUND));
}

export function readingEstimate(messages: ImportedMessage[], mode: 'live' | 'batch'): ReadingEstimate {
  const n = messagesToRead(messages);
  const pieces = piecesFor(n);
  return { messages: n, pieces, minutes: minutesFor(pieces, mode) };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "This chat has 1,240 messages to read. About 3 minutes." (or "These 3 chats have …" for a multi-file import). */
export function readingLine(e: { messages: number; minutes: number }, chats = 1): string {
  const head = chats > 1 ? `These ${chats} chats have` : 'This chat has';
  return `${head} ${plural(e.messages, 'message', 'messages')} to read. About ${plural(Math.max(1, e.minutes), 'minute', 'minutes')}.`;
}
