import type { ConsumeResult, WhatsAppLink, WhatsAppLinkStore } from '../../ports/whatsapp.js';

/** [P67] In-memory WhatsApp link store (tests, local dev). Same rules as the Postgres one. */
export class InMemoryWhatsAppLinkStore implements WhatsAppLinkStore {
  private readonly links = new Map<string, WhatsAppLink>();
  private readonly codes = new Map<string, { phone: string; codeHash: string; expiresAt: number; attempts: number }>();
  private readonly seen = new Set<string>();

  async get(userId: string): Promise<WhatsAppLink | null> { return this.links.get(userId) ?? null; }
  async byPhone(phone: string): Promise<WhatsAppLink | null> { return [...this.links.values()].find((l) => l.phone === phone) ?? null; }
  async byWaUserId(id: string): Promise<WhatsAppLink | null> { return [...this.links.values()].find((l) => l.waUserId === id) ?? null; }

  async putCode(userId: string, phone: string, codeHash: string, expiresAt: number): Promise<void> {
    this.codes.set(userId, { phone, codeHash, expiresAt, attempts: 0 });
  }

  async consumeCode(phone: string, codeHash: string, nowMs: number): Promise<ConsumeResult> {
    const pending = [...this.codes.entries()].filter(([, c]) => c.phone === phone && c.attempts < 5);
    if (pending.length === 0) return { ok: false, reason: 'no_code' };
    const hit = pending.find(([, c]) => c.codeHash === codeHash);
    if (!hit) { for (const [, c] of pending) c.attempts += 1; return { ok: false, reason: 'wrong_code' }; }
    const [userId, c] = hit;
    this.codes.delete(userId);
    if (c.expiresAt <= nowMs) return { ok: false, reason: 'expired' };
    return { ok: true, userId };
  }

  async link(userId: string, phone: string, waUserId: string | null, nowMs: number): Promise<{ ok: true } | { ok: false; reason: 'taken' }> {
    const other = [...this.links.values()].find((l) => l.userId !== userId && (l.phone === phone || (waUserId !== null && l.waUserId === waUserId)));
    if (other) return { ok: false, reason: 'taken' };
    this.links.set(userId, { userId, phone, waUserId, linkedAt: nowMs });
    return { ok: true };
  }

  async unlink(userId: string): Promise<void> { this.links.delete(userId); this.codes.delete(userId); }

  async firstDelivery(messageId: string): Promise<boolean> {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    return true;
  }

  /** [account deletion] what the users ON DELETE CASCADE does in Postgres. */
  async deleteUser(userId: string): Promise<void> { await this.unlink(userId); }
}
