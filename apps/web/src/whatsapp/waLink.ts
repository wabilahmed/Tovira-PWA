/**
 * Reduce a stored phone to wa.me-ready digits, or null if we can't safely dial
 * it. A country code is REQUIRED and never guessed: a bare local number could
 * belong to any country, so without an explicit `+` (E.164) or `00` international
 * prefix we return null and let WhatsApp open the picker. Malformed or
 * implausibly short input also returns null.
 */
export function toDialableDigits(phone: string | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const hasCountryCode = trimmed.startsWith('+') || trimmed.startsWith('00');
  if (!hasCountryCode) return null;
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, ''); // drop the 00 prefix
  // E.164 numbers are 8–15 digits (including the country code).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Build a wa.me deep link that opens WhatsApp with a message pre-filled (P4-7).
 * Tovira NEVER sends — this only opens WhatsApp; the rep taps send there. The
 * text is URL-encoded so emojis, line breaks and Arabic survive intact. A phone
 * with an explicit country code targets the contact; otherwise WhatsApp opens
 * the picker (we never guess a country code).
 */
export function whatsappLink(text: string, phone?: string): string {
  const digits = toDialableDigits(phone);
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
