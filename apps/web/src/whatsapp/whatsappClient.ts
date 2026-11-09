/**
 * [P67 · owner] Send chats on WhatsApp: the rep's linked number. GET /whatsapp/link answers 404 while the feature is
 * switched off, and then nothing about it is shown anywhere.
 */
export interface WhatsAppStatus { linked: { phone: string; linkedAt: number } | null; businessNumber: string }
export type StartLink = { ok: true; code: string; phone: string; waLink: string; expiresAt: number } | { ok: false; message: string };

export interface WhatsAppApi {
  /** null = switched off (or not reachable): show nothing. */
  status(): Promise<WhatsAppStatus | null>;
  startLink(phone: string): Promise<StartLink>;
  unlink(): Promise<WhatsAppStatus | null>;
}

/** Only a real answer (Tovira's number present) turns the section on; anything else reads as switched off. */
function statusOf(b: unknown): WhatsAppStatus | null {
  const o = b as Partial<WhatsAppStatus> | null;
  if (!o || typeof o.businessNumber !== 'string' || !o.businessNumber) return null;
  return { businessNumber: o.businessNumber, linked: o.linked && typeof o.linked.phone === 'string' ? o.linked : null };
}

export class WhatsAppClient implements WhatsAppApi {
  constructor(private readonly baseUrl = '') {}
  async status(): Promise<WhatsAppStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/whatsapp/link`, { credentials: 'include' });
      return res.status === 200 ? statusOf(await res.json()) : null;
    } catch { return null; }
  }
  async startLink(phone: string): Promise<StartLink> {
    try {
      const res = await fetch(`${this.baseUrl}/whatsapp/link`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
      const b = (await res.json().catch(() => ({}))) as Partial<StartLink> & { message?: string };
      if (res.status === 200 && 'code' in b) return { ok: true, code: b.code!, phone: b.phone!, waLink: b.waLink!, expiresAt: b.expiresAt! };
      return { ok: false, message: b.message ?? 'Couldn’t start linking just now. Try again.' };
    } catch { return { ok: false, message: 'Couldn’t start linking just now. Try again.' }; }
  }
  async unlink(): Promise<WhatsAppStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/whatsapp/link`, { method: 'DELETE', credentials: 'include' });
      return res.status === 200 ? statusOf(await res.json()) : null;
    } catch { return null; }
  }
}

/** A contact card for Tovira's number, so the rep can find "Tovira" in WhatsApp's share list. */
export function toviraVCard(businessNumber: string): string {
  return ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Tovira', 'ORG:Tovira', `TEL;TYPE=CELL:${businessNumber}`, 'END:VCARD', ''].join('\r\n');
}
