import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Storage } from '../../ports/storage.js';
import { MediaTooLargeError, type WhatsAppGraph, type WhatsAppLink, type WhatsAppLinkStore } from '../../ports/whatsapp.js';
import type { RateLimiter } from '../security/rate-limiter.js';
import { canonicalPhone } from '../clients/phone.js';
import { MAX_IMPORT_UPLOAD_BYTES } from '../import/bulk-decode.js';
import { putBatchFile } from '../import/bulk-batch-store.js';
import { parseWhatsAppExport } from '../import/whatsapp.js';
import { readChatExport, exportLogLine } from './export-file.js';
import { counterpartFromFileName } from '../import/misfile.js';
import { isTooLong, tooLongMessage } from '../import/long-chat.js';
import { inboundMessages, linkCodeOf, type InboundMessage } from './payload.js';
import { REPLY } from './copy.js';

/**
 * [P67 · owner] Send a chat export to Tovira's WhatsApp number.
 *
 * Linking (no SMS): the rep enters their number in Settings and gets a one-time code; a wa.me link opens WhatsApp with
 * "LINK 482193" typed to Tovira's number. That message arriving FROM that number proves they own it. 15 minutes, once.
 *
 * Receiving: a linked rep's exported chat is downloaded at once, its chat text found (readChatExport [P79]: a zip opens
 * only the chat text, media is never read), checked by the same parser as "Choose the chat export", and staged exactly like a one-file upload in the import review's
 * holding area. Tovira replies with a link to the confirm step; NOTHING is read until the rep confirms who it's with.
 * Anything else stores nothing and gets a one-line reply (essential replies only: owner, 9 Nov).
 */
export const LINK_CODE_TTL_MS = 15 * 60_000;

export interface WhatsAppSettings {
  /** Tovira's WhatsApp Business number, E.164 (shown to reps, and the wa.me target). */
  businessNumber: string;
  /** Public base URL of the app, for the confirm link. */
  appBaseUrl: string;
}

export interface WhatsAppServiceDeps {
  settings: WhatsAppSettings;
  store: WhatsAppLinkStore;
  graph: WhatsAppGraph;
  storage: Storage;
  /** Trial over and no plan (or suspended): told why, nothing stored. */
  entitlement: (userId: string, nowMs: number) => Promise<{ entitled: boolean; status: string }>;
  /** [P67-1] the long-chat rule (null = no limit, windowed extraction). */
  longChatLimit?: number | null;
  /** At most one "not linked" reply per number per day, and a few help replies per hour: replies cost money past 1,000 a month. */
  unlinkedReplies?: RateLimiter;
  helpReplies?: RateLimiter;
  /** Chats per rep per hour. */
  perRep?: RateLimiter;
  /** [P75] The number the rep gave on their access request (E.164), to pre-fill the verify step; null when none. */
  requestedNumber?: (userId: string) => Promise<string | null>;
  /** [P75] A sender's tries at a code made for another number (5 an hour), so a code can't be guessed from a stranger's phone. */
  linkGuesses?: RateLimiter;
  now?: () => number;
}

const TAKEN = 'This number is linked to another Tovira account.';

/** [P75] What Settings, the first sign-in step and the Today banner read. */
export interface WhatsAppStatus {
  linked: { phone: string; linkedAt: number } | null;
  businessNumber: string;
  requestedNumber: string | null;
  awaitingConfirm: { phone: string } | null;
}

const hashCode = (code: string): string => createHash('sha256').update(`tovira-wa-link:${code}`).digest('hex');
const keyOf = (m: InboundMessage): string => createHash('sha256').update(m.phone ?? `id:${m.waUserId ?? m.id}`).digest('hex');

export class WhatsAppService {
  private readonly inflight = new Set<Promise<void>>();
  constructor(private readonly deps: WhatsAppServiceDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  // ---------- Settings (the rep, signed in) ----------

  /** [P75] `linked` is the verified number (verified on `linkedAt`); `requestedNumber` the one from the access request;
   *  `awaitingConfirm` a number a code arrived from that the rep has not confirmed yet (never linked until they do). */
  async status(userId: string): Promise<WhatsAppStatus> {
    const l = await this.deps.store.get(userId);
    const waiting = await this.deps.store.getConfirm(userId, this.now());
    return {
      linked: l ? { phone: l.phone, linkedAt: l.linkedAt } : null,
      businessNumber: this.deps.settings.businessNumber,
      requestedNumber: (await this.deps.requestedNumber?.(userId)) ?? null,
      awaitingConfirm: waiting ? { phone: waiting.phone } : null,
    };
  }

  /** [P75] The verified number only (Admin → Access). */
  async verifiedOf(userId: string): Promise<{ phone: string; linkedAt: number } | null> {
    const l = await this.deps.store.get(userId);
    return l ? { phone: l.phone, linkedAt: l.linkedAt } : null;
  }

  async startLink(userId: string, rawPhone: string): Promise<{ ok: true; code: string; phone: string; waLink: string; expiresAt: number } | { ok: false; status: number; message: string }> {
    const p = canonicalPhone(rawPhone);
    if (!p.ok) return { ok: false, status: 400, message: p.message };
    const other = await this.deps.store.byPhone(p.phone);
    if (other && other.userId !== userId) return { ok: false, status: 409, message: 'This number is linked to another Tovira account.' };
    // [P75] a code names one rep: drawn again if another rep's pending code has the same digits
    let code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    for (let i = 0; i < 5 && (await this.deps.store.codeInUse(hashCode(code))); i++) code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = this.now() + LINK_CODE_TTL_MS;
    // [P75] A new code replaces the old one (one per rep) and voids a number waiting for confirmation.
    await this.deps.store.putCode(userId, p.phone, hashCode(code), expiresAt);
    await this.deps.store.clearConfirm(userId);
    const digits = this.deps.settings.businessNumber.replace(/\D/g, '');
    return { ok: true, code, phone: p.phone, waLink: `https://wa.me/${digits}?text=${encodeURIComponent(`LINK ${code}`)}`, expiresAt };
  }

  async unlink(userId: string): Promise<void> { await this.deps.store.unlink(userId); }

  /** [P75] The rep's answer to "Your code came from <number>": yes links THAT number (the one the message came from),
   *  no forgets it. Nothing waiting (or expired) = 'gone'. */
  async confirm(userId: string, accept: boolean): Promise<{ ok: true } | { ok: false; reason: 'gone' | 'taken' }> {
    const waiting = await this.deps.store.takeConfirm(userId, this.now());
    if (!waiting) return { ok: false, reason: 'gone' };
    if (!accept) return { ok: true };
    const linked = await this.deps.store.link(userId, waiting.phone, waiting.waUserId, this.now());
    return linked.ok ? { ok: true } : { ok: false, reason: 'taken' };
  }

  // ---------- The webhook (Meta, signature already checked) ----------

  /** Handle a verified webhook body in the background (Meta wants a fast 200). */
  accept(body: unknown): void {
    for (const m of inboundMessages(body)) {
      const p = this.handle(m).catch((err: unknown) => console.warn(`[whatsapp] message not handled (${err instanceof Error ? err.name : 'error'})`));
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
    }
  }

  /** Everything accepted so far has finished (tests). */
  async idle(): Promise<void> { while (this.inflight.size > 0) await Promise.all([...this.inflight]); }

  private async reply(m: InboundMessage, body: string): Promise<void> {
    await this.deps.graph.sendText({ phone: m.phone, waUserId: m.waUserId }, body).catch((err: unknown) => console.warn(`[whatsapp] reply not sent (${err instanceof Error ? err.message : 'error'})`));
  }

  private limited(l: RateLimiter | undefined, key: string): boolean {
    if (!l) return false;
    if (l.check(key, this.now()).limited) return true;
    l.record(key, this.now());
    return false;
  }

  private async linkOf(m: InboundMessage): Promise<WhatsAppLink | null> {
    return (m.phone ? await this.deps.store.byPhone(m.phone) : null) ?? (m.waUserId ? await this.deps.store.byWaUserId(m.waUserId) : null);
  }

  async handle(m: InboundMessage): Promise<void> {
    if (!(await this.deps.store.firstDelivery(m.id, this.now()))) return; // a repeat delivery: already handled

    const code = m.type === 'text' ? linkCodeOf(m.text) : null;
    if (code) { await this.handleLinkCode(m, code); return; }

    const link = await this.linkOf(m);
    if (!link) {
      if (!this.limited(this.deps.unlinkedReplies, keyOf(m))) await this.reply(m, REPLY.notLinked);
      return; // nothing stored
    }

    if (m.type !== 'document') {
      if (!this.limited(this.deps.helpReplies, keyOf(m))) await this.reply(m, m.type === 'text' ? REPLY.help : REPLY.unsupported);
      return;
    }

    const ent = await this.deps.entitlement(link.userId, this.now());
    if (!ent.entitled) { await this.reply(m, REPLY.inactive(ent.status, this.deps.settings.appBaseUrl)); return; }
    if (this.limited(this.deps.perRep, link.userId)) { await this.reply(m, REPLY.tooMany); return; }
    await this.handleDocument(m, link.userId);
  }

  private async handleLinkCode(m: InboundMessage, code: string): Promise<void> {
    if (!m.phone) { await this.reply(m, REPLY.wrongCode); return; } // no number shared: nothing to prove
    const r = await this.deps.store.consumeCode(m.phone, hashCode(code), this.now());
    if (r.ok) {
      const linked = await this.deps.store.link(r.userId, m.phone, m.waUserId, this.now());
      // [P79 · owner] "Linked" in WhatsApp too (was no reply: the rep sent the code and heard nothing back).
      await this.reply(m, linked.ok ? REPLY.linked : TAKEN);
      return;
    }
    if (r.reason === 'expired') { await this.reply(m, REPLY.wrongCode); return; }
    // [P75 · owner] Not a code for this number: maybe the rep's code sent from a different number. That links NOTHING;
    // the number it came from waits for the rep to confirm it in the app. A sender gets 5 such tries an hour.
    if (this.limited(this.deps.linkGuesses, keyOf(m))) { await this.reply(m, REPLY.wrongCode); return; }
    const any = await this.deps.store.consumeCodeAnyNumber(hashCode(code), this.now());
    if (!any.ok) { await this.reply(m, REPLY.wrongCode); return; }
    const owner = await this.deps.store.byPhone(m.phone);
    if (owner && owner.userId !== any.userId) { await this.reply(m, TAKEN); return; }
    if (owner && owner.userId === any.userId) return; // already this rep's verified number: nothing to ask
    await this.deps.store.putConfirm(any.userId, m.phone, m.waUserId, this.now() + LINK_CODE_TTL_MS);
    await this.reply(m, REPLY.confirmInApp);
  }

  private async handleDocument(m: InboundMessage, userId: string): Promise<void> {
    const doc = m.document!;
    const ext = /\.([a-z0-9]{1,8})$/i.exec(doc.fileName ?? '')?.[0]?.toLowerCase() ?? '';
    const log = (bytes: number, result: string, meta: Parameters<typeof exportLogLine>[1] = { kind: 'binary' }) =>
      console.info(exportLogLine({ mime: doc.mimeType, ext, bytes, result }, meta));
    let bytes: Uint8Array;
    try {
      const media = await this.deps.graph.mediaUrl(doc.mediaId);
      if (media.fileSize !== null && media.fileSize > MAX_IMPORT_UPLOAD_BYTES) { log(media.fileSize, 'too large (declared)'); await this.reply(m, REPLY.tooLarge); return; }
      bytes = await this.deps.graph.download(media.url, MAX_IMPORT_UPLOAD_BYTES);
    } catch (err) {
      const big = err instanceof MediaTooLargeError;
      log(0, big ? 'too large (download)' : 'download failed');
      await this.reply(m, big ? REPLY.tooLarge : REPLY.couldNotDownload);
      return;
    }
    // [P79 · owner] Decided by the bytes, never the MIME type Meta gives it: a zip (iPhone, with or without media) opens
    // ONLY its chat text; media is never decompressed. Nothing is written anywhere unless it is a chat; the downloaded
    // bytes live in this function's memory only and are dropped when it returns.
    const fileName = doc.fileName ?? 'WhatsApp Chat.txt';
    const r = readChatExport(fileName, bytes);
    if (!r.ok) {
      log(bytes.length, r.reason, r.meta);
      await this.reply(m, r.reason === 'too_large' ? REPLY.tooLarge : r.reason === 'web_page' ? REPLY.couldNotDownload : REPLY.notAnExport);
      return; // nothing stored
    }
    const parsed = parseWhatsAppExport(r.file.content);
    if (!parsed.ok || parsed.messages.length === 0) { log(bytes.length, 'not_export', r.meta); await this.reply(m, REPLY.notAnExport); return; }
    const limit = this.deps.longChatLimit ?? null;
    if (isTooLong(parsed.messages.length, limit)) { log(bytes.length, 'too long', r.meta); await this.reply(m, tooLongMessage(parsed.messages.length, limit!)); return; }

    const batchId = `wa-${randomUUID()}`;
    await putBatchFile(this.deps.storage, userId, batchId, 0, r.file, this.now());
    log(bytes.length, 'staged', r.meta);
    console.info(`[whatsapp] chat staged for rep ${userId} (batch ${batchId}); nothing read until the rep confirms`);
    const link = `${this.deps.settings.appBaseUrl}/app?import=${encodeURIComponent(batchId)}`;
    await this.reply(m, REPLY.gotChat(counterpartFromFileName(fileName), link));
  }
}
