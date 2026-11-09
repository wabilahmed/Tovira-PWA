import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Storage } from '../../ports/storage.js';
import { MediaTooLargeError, type WhatsAppGraph, type WhatsAppLink, type WhatsAppLinkStore } from '../../ports/whatsapp.js';
import type { RateLimiter } from '../security/rate-limiter.js';
import { canonicalPhone } from '../clients/phone.js';
import { decodeBulkFileBytes, MAX_IMPORT_UPLOAD_BYTES } from '../import/bulk-decode.js';
import { putBatchFile } from '../import/bulk-batch-store.js';
import { parseWhatsAppExport } from '../import/whatsapp.js';
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
 * Receiving: a linked rep's exported chat is downloaded at once, decoded and checked by the same code as "Choose the
 * chat export" (decodeBulkFileBytes, the same parser), and staged exactly like a one-file upload in the import review's
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
  now?: () => number;
}

const hashCode = (code: string): string => createHash('sha256').update(`tovira-wa-link:${code}`).digest('hex');
const keyOf = (m: InboundMessage): string => createHash('sha256').update(m.phone ?? `id:${m.waUserId ?? m.id}`).digest('hex');

export class WhatsAppService {
  private readonly inflight = new Set<Promise<void>>();
  constructor(private readonly deps: WhatsAppServiceDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  // ---------- Settings (the rep, signed in) ----------

  async status(userId: string): Promise<{ linked: { phone: string; linkedAt: number } | null; businessNumber: string }> {
    const l = await this.deps.store.get(userId);
    return { linked: l ? { phone: l.phone, linkedAt: l.linkedAt } : null, businessNumber: this.deps.settings.businessNumber };
  }

  async startLink(userId: string, rawPhone: string): Promise<{ ok: true; code: string; phone: string; waLink: string; expiresAt: number } | { ok: false; status: number; message: string }> {
    const p = canonicalPhone(rawPhone);
    if (!p.ok) return { ok: false, status: 400, message: p.message };
    const other = await this.deps.store.byPhone(p.phone);
    if (other && other.userId !== userId) return { ok: false, status: 409, message: 'This number is linked to another Tovira account.' };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = this.now() + LINK_CODE_TTL_MS;
    await this.deps.store.putCode(userId, p.phone, hashCode(code), expiresAt);
    const digits = this.deps.settings.businessNumber.replace(/\D/g, '');
    return { ok: true, code, phone: p.phone, waLink: `https://wa.me/${digits}?text=${encodeURIComponent(`LINK ${code}`)}`, expiresAt };
  }

  async unlink(userId: string): Promise<void> { await this.deps.store.unlink(userId); }

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
    if (!r.ok) { await this.reply(m, REPLY.wrongCode); return; }
    const linked = await this.deps.store.link(r.userId, m.phone, m.waUserId, this.now());
    if (!linked.ok) await this.reply(m, 'This number is linked to another Tovira account.');
    // Linked: no reply (essential replies only). The app's Settings shows "Linked" on its next check.
  }

  private async handleDocument(m: InboundMessage, userId: string): Promise<void> {
    const doc = m.document!;
    let bytes: Uint8Array;
    try {
      const media = await this.deps.graph.mediaUrl(doc.mediaId);
      if (media.fileSize !== null && media.fileSize > MAX_IMPORT_UPLOAD_BYTES) { await this.reply(m, REPLY.tooLarge); return; }
      bytes = await this.deps.graph.download(media.url, MAX_IMPORT_UPLOAD_BYTES);
    } catch (err) {
      await this.reply(m, err instanceof MediaTooLargeError ? REPLY.tooLarge : REPLY.couldNotDownload);
      return;
    }
    // The same decode and parser as "Choose the chat export": a .zip (iPhone) or a .txt (Android), media dropped unread.
    const fileName = doc.fileName ?? 'WhatsApp Chat.txt';
    const file = decodeBulkFileBytes(fileName, bytes);
    const parsed = file.content ? parseWhatsAppExport(file.content) : null;
    if (!parsed || !parsed.ok || parsed.messages.length === 0) { await this.reply(m, REPLY.notAnExport); return; } // nothing stored
    const limit = this.deps.longChatLimit ?? null;
    if (isTooLong(parsed.messages.length, limit)) { await this.reply(m, tooLongMessage(parsed.messages.length, limit!)); return; }

    const batchId = `wa-${randomUUID()}`;
    await putBatchFile(this.deps.storage, userId, batchId, 0, file, this.now());
    console.info(`[whatsapp] chat staged for rep ${userId} (batch ${batchId}); nothing read until the rep confirms`);
    const link = `${this.deps.settings.appBaseUrl}/app?import=${encodeURIComponent(batchId)}`;
    await this.reply(m, REPLY.gotChat(counterpartFromFileName(fileName), link));
  }
}
