/**
 * [P67 · owner] Ports for receiving chat exports on Tovira's WhatsApp Business number (WhatsApp Cloud API).
 */

export interface WhatsAppLink {
  userId: string;
  /** E.164, e.g. "+971501234567". */
  phone: string;
  /** Meta's business-scoped user id (BSUID), when the sender has one; a user with a WhatsApp username may arrive without a phone. */
  waUserId: string | null;
  linkedAt: number;
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'no_code' | 'wrong_code' | 'expired' };

export interface WhatsAppLinkStore {
  get(userId: string): Promise<WhatsAppLink | null>;
  byPhone(phone: string): Promise<WhatsAppLink | null>;
  byWaUserId(waUserId: string): Promise<WhatsAppLink | null>;
  /** The rep's one pending code (any earlier one is replaced). */
  putCode(userId: string, phone: string, codeHash: string, expiresAt: number): Promise<void>;
  /** A "LINK <code>" from `phone`: matches a pending code for that number, once; a wrong guess counts an attempt and the
   *  code dies after 5 wrong attempts. On success the code is deleted. */
  consumeCode(phone: string, codeHash: string, nowMs: number): Promise<ConsumeResult>;
  /** Link the number to the rep (replacing the rep's previous number). Refused when the number is linked to another account. */
  link(userId: string, phone: string, waUserId: string | null, nowMs: number): Promise<{ ok: true } | { ok: false; reason: 'taken' }>;
  unlink(userId: string): Promise<void>;
  /** True the first time a Meta message id is seen; false for a repeat delivery. */
  firstDelivery(messageId: string, nowMs: number): Promise<boolean>;
}

/** The Graph API calls we make. The access token never leaves the adapter and is never logged. */
export interface WhatsAppGraph {
  /** The media's short-lived download URL (valid about 5 minutes) and size. */
  mediaUrl(mediaId: string): Promise<{ url: string; fileSize: number | null; mimeType: string | null }>;
  /** Download from that URL with the token; refuses (throws MediaTooLarge) past `maxBytes`. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
  /** A free-form text reply (only inside the 24-hour customer-service window, which a message from the rep opens). */
  sendText(to: { phone?: string | null; waUserId?: string | null }, body: string): Promise<void>;
}

export class MediaTooLargeError extends Error {}
