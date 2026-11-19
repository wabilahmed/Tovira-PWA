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

/**
 * [P79-EMERGENCY · owner, 19 Nov] Until P68 ships: no chat over 3,000 messages (after the date cut) is read, windowed or
 * not. A 28,357-message chat was read in 284 pieces for hours, twice in parallel. Every route that imports a chat (the
 * WhatsApp number, "Import chat", the multi-file upload) refuses it with EMERGENCY_TOO_LONG, and the extraction path
 * refuses a stored one before any model call.
 */
export const EMERGENCY_MAX_MESSAGES = 3_000;
export const EMERGENCY_TOO_LONG = "This chat is too long for now. We're working on it. Try a shorter chat.";

/** The limit in force: the emergency limit, windowed or not (was: none when windowed extraction was on). */
export function longChatLimit(_windowingEnabled: boolean): number | null {
  return EMERGENCY_MAX_MESSAGES;
}

export function isTooLong(messagesToRead: number, limit: number | null): boolean {
  return limit !== null && messagesToRead > limit;
}

/** What the rep reads. WhatsApp can't export part of a chat, so the way out is to contact us. */
export function tooLongMessage(_messagesToRead: number, _limit: number): string {
  return EMERGENCY_TOO_LONG; // [P79-EMERGENCY · owner] wording
}

/** The P67-1 wording, kept for reference until P68 decides the copy. */
export function p67TooLongMessage(messagesToRead: number, limit: number): string {
  return `This chat is too long to analyse in one go: ${messagesToRead.toLocaleString('en-US')} messages, and the limit for now is ${limit.toLocaleString('en-US')}. WhatsApp can't export part of a chat, so contact us at hello@tovira.io and we'll help.`;
}
