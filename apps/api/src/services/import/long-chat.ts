/**
 * [P67-1 · owner] A chat too long to read in one go is refused BEFORE it is read, with a clear message, instead of
 * being sent to the model and failing after minutes (or being cut to its most recent part).
 *
 * The limit counts the messages Tovira would actually read: the new ones (a re-export only reads what isn't stored
 * yet). 5,000 is an interim number below the largest chat read cleanly in the lab (5,615 messages, 98 seconds); the
 * real breaking point is measured separately (it needs a real model run, so it waits for the owner's go-ahead).
 * Windowed extraction (EXTRACT_WINDOWED) reads a long chat in parts, so with it on there is no limit.
 */
export const LONG_CHAT_MAX_MESSAGES = 5_000;

/** The limit in force: none when windowed extraction reads long chats in parts. */
export function longChatLimit(windowingEnabled: boolean): number | null {
  return windowingEnabled ? null : LONG_CHAT_MAX_MESSAGES;
}

export function isTooLong(messagesToRead: number, limit: number | null): boolean {
  return limit !== null && messagesToRead > limit;
}

/** What the rep reads. WhatsApp can't export part of a chat, so the way out is to contact us. */
export function tooLongMessage(messagesToRead: number, limit: number): string {
  return `This chat is too long to analyse in one go: ${messagesToRead.toLocaleString('en-US')} messages, and the limit for now is ${limit.toLocaleString('en-US')}. WhatsApp can't export part of a chat, so contact us at hello@tovira.io and we'll help.`;
}
