import type { Pool } from 'pg';
import type { ConsumeResult, WhatsAppLink, WhatsAppLinkStore } from '../../ports/whatsapp.js';

const toMs = (d: Date | string): number => (d instanceof Date ? d.getTime() : Date.parse(d));
const ts = (ms: number): string => new Date(ms).toISOString();
/** Handled message ids are kept 14 days: Meta retries an unacknowledged delivery for up to 7. */
const SEEN_KEEP_MS = 14 * 86_400_000;

/**
 * [P67] The WhatsApp link tables (migration 0115). The webhook reads them before any tenant is known (a sender is
 * matched by number), so they are not tenant-RLS (RLS_EXEMPT, with the reason) and are queried on the app pool directly.
 */
export class PgWhatsAppLinkStore implements WhatsAppLinkStore {
  private lastPurge = 0;
  constructor(private readonly pool: Pool) {}

  private row(r: Record<string, unknown> | undefined): WhatsAppLink | null {
    if (!r) return null;
    return { userId: String(r.user_id), phone: String(r.phone_e164), waUserId: (r.wa_user_id as string | null) ?? null, linkedAt: toMs(r.linked_at as Date) };
  }
  async get(userId: string): Promise<WhatsAppLink | null> {
    return this.row((await this.pool.query('SELECT * FROM whatsapp_links WHERE user_id = $1', [userId])).rows[0]);
  }
  async byPhone(phone: string): Promise<WhatsAppLink | null> {
    return this.row((await this.pool.query('SELECT * FROM whatsapp_links WHERE phone_e164 = $1', [phone])).rows[0]);
  }
  async byWaUserId(id: string): Promise<WhatsAppLink | null> {
    return this.row((await this.pool.query('SELECT * FROM whatsapp_links WHERE wa_user_id = $1', [id])).rows[0]);
  }

  async putCode(userId: string, phone: string, codeHash: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp_link_codes (user_id, phone_e164, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
      [userId, phone, codeHash, ts(expiresAt)],
    );
  }

  async consumeCode(phone: string, codeHash: string, nowMs: number): Promise<ConsumeResult> {
    // One statement takes the matching code (single use, even with two deliveries racing).
    const hit = await this.pool.query(
      'DELETE FROM whatsapp_link_codes WHERE phone_e164 = $1 AND code_hash = $2 AND attempts < 5 RETURNING user_id, expires_at',
      [phone, codeHash],
    );
    const r = hit.rows[0];
    if (r) return toMs(r.expires_at as Date) <= nowMs ? { ok: false, reason: 'expired' } : { ok: true, userId: String(r.user_id) };
    const miss = await this.pool.query('UPDATE whatsapp_link_codes SET attempts = attempts + 1 WHERE phone_e164 = $1 AND attempts < 5 RETURNING user_id', [phone]);
    return { ok: false, reason: miss.rows.length > 0 ? 'wrong_code' : 'no_code' };
  }

  async link(userId: string, phone: string, waUserId: string | null, nowMs: number): Promise<{ ok: true } | { ok: false; reason: 'taken' }> {
    try {
      await this.pool.query(
        `INSERT INTO whatsapp_links (user_id, phone_e164, wa_user_id, linked_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, wa_user_id = EXCLUDED.wa_user_id, linked_at = EXCLUDED.linked_at`,
        [userId, phone, waUserId, ts(nowMs)],
      );
      return { ok: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return { ok: false, reason: 'taken' }; // the number (or id) is another account's
      throw err;
    }
  }

  async unlink(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM whatsapp_links WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM whatsapp_link_codes WHERE user_id = $1', [userId]);
  }

  async firstDelivery(messageId: string, nowMs: number): Promise<boolean> {
    const { rows } = await this.pool.query('INSERT INTO whatsapp_inbound (message_id, received_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id', [messageId, ts(nowMs)]);
    if (nowMs - this.lastPurge > 3_600_000) {
      this.lastPurge = nowMs;
      await this.pool.query('DELETE FROM whatsapp_inbound WHERE received_at < $1', [ts(nowMs - SEEN_KEEP_MS)]).catch(() => undefined);
    }
    return rows.length > 0;
  }
}
