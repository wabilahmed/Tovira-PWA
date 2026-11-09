/**
 * [P67] The inbound messages in a WhatsApp Cloud API webhook (field "messages"). Delivery statuses for our own replies
 * arrive in the same field under `statuses` and are ignored. A sender may come without a phone number (a WhatsApp
 * username user): then only their business-scoped user id (`from_user_id` / `contacts[].user_id`) identifies them.
 */
export interface InboundMessage {
  id: string;
  /** E.164 with "+" (Meta sends digits only), or null when the sender has a username and no number is shared. */
  phone: string | null;
  waUserId: string | null;
  type: 'text' | 'document' | 'other';
  text?: string;
  document?: { mediaId: string; fileName: string | null; mimeType: string | null };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function inboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    for (const ch of (e as { changes?: unknown[] })?.changes ?? []) {
      const c = ch as { field?: string; value?: { messages?: unknown[]; contacts?: unknown[] } };
      if (c.field !== 'messages' || !Array.isArray(c.value?.messages)) continue;
      const contacts = (c.value!.contacts ?? []) as Array<{ wa_id?: string; user_id?: string }>;
      for (const raw of c.value!.messages!) {
        const m = raw as { id?: unknown; from?: unknown; from_user_id?: unknown; type?: unknown; text?: { body?: unknown }; document?: { id?: unknown; filename?: unknown; mime_type?: unknown } };
        const id = str(m.id);
        if (!id) continue;
        const digits = str(m.from)?.replace(/\D/g, '') ?? null;
        const contact = contacts.find((k) => digits && k.wa_id?.replace(/\D/g, '') === digits) ?? (contacts.length === 1 ? contacts[0] : undefined);
        const msg: InboundMessage = { id, phone: digits ? `+${digits}` : null, waUserId: str(m.from_user_id) ?? str(contact?.user_id), type: 'other' };
        if (m.type === 'text' && str(m.text?.body)) { msg.type = 'text'; msg.text = String(m.text!.body); }
        else if (m.type === 'document' && str(m.document?.id)) {
          msg.type = 'document';
          msg.document = { mediaId: str(m.document!.id)!, fileName: str(m.document!.filename), mimeType: str(m.document!.mime_type) };
        }
        out.push(msg);
      }
    }
  }
  return out;
}

/** "LINK 482193" (any case, spaces allowed), the message the rep sends from the Settings link. */
export function linkCodeOf(text: string | undefined): string | null {
  const m = /^\s*link\s*(\d{6})\s*$/i.exec(text ?? '');
  return m ? m[1]! : null;
}
