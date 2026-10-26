import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * [P46-4] A client phone, validated and stored in its canonical international form (E.164: "+971503863103"); the app
 * shows it formatted ("+971 50 386 3103"). A number without a country code is refused with the fix: Tovira never
 * guesses the country, because a wrong number is worse than a missing one.
 */
export type PhoneResult = { ok: true; phone: string } | { ok: false; message: string };

export const NEEDS_COUNTRY_CODE = 'Add the country code, for example +971 50 123 4567.';
export const NOT_A_NUMBER = 'That doesn’t look like a phone number. Check it and try again.';

export function canonicalPhone(raw: string): PhoneResult {
  const compact = raw.trim().replace(/[()\s.-]/g, '');
  if (!/^\+?\d+$/.test(compact.replace(/^00/, '+'))) return { ok: false, message: NOT_A_NUMBER };
  const intl = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!intl.startsWith('+')) return { ok: false, message: NEEDS_COUNTRY_CODE };
  const parsed = parsePhoneNumberFromString(intl);
  if (!parsed || !parsed.isValid()) return { ok: false, message: NOT_A_NUMBER };
  return { ok: true, phone: parsed.number };
}
