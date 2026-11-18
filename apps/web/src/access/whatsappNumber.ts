import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * [P75 · owner] The request form's WhatsApp number: a country-code picker (no country chosen for the rep, none named
 * in the copy) and the number. Sent to the server in E.164; the server checks it again. A full international number
 * typed in the field ("+44 …" or "0044 …") wins over the picker.
 */
export const WHATSAPP_REQUIRED = 'Please choose your country code and enter your WhatsApp number.';
export const WHATSAPP_INVALID = 'That doesn’t look like a WhatsApp number. Check the country code and the number.';

export type E164Result = { ok: true; e164: string } | { ok: false; message: string };

export function toE164(country: string, raw: string): E164Result {
  const typed = raw.trim().replace(/[()\s.-]/g, '');
  if (!typed) return { ok: false, message: WHATSAPP_REQUIRED };
  if (!/^(\+|00)?\d+$/.test(typed)) return { ok: false, message: WHATSAPP_INVALID };
  const intl = typed.startsWith('00') ? `+${typed.slice(2)}` : typed;
  if (!intl.startsWith('+') && !country) return { ok: false, message: WHATSAPP_REQUIRED };
  const p = intl.startsWith('+') ? parsePhoneNumberFromString(intl) : parsePhoneNumberFromString(intl, country as CountryCode);
  if (!p || !p.isValid()) return { ok: false, message: WHATSAPP_INVALID };
  return { ok: true, e164: p.number };
}

/** Every country, by name: "United Kingdom +44". */
export function countryCodeOptions(): Array<{ value: string; label: string }> {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }
  return getCountries()
    .map((c) => ({ value: c, label: `${names?.of(c) ?? c} +${getCountryCallingCode(c)}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
