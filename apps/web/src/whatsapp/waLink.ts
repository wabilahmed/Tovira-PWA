/**
 * Build a wa.me deep link that opens WhatsApp with a message pre-filled (P4-7).
 * Tovira NEVER sends — this only opens WhatsApp; the rep taps send there. The
 * text is URL-encoded so emojis, line breaks and Arabic survive intact. A phone
 * (digits only) targets the contact; without one, WhatsApp opens the picker.
 */
export function whatsappLink(text: string, phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
