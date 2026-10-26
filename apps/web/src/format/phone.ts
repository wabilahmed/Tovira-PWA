import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** [P46-4] The fix shown for a number stored or typed without a country code (the server says the same). */
export const NEEDS_COUNTRY_CODE = 'Add the country code, for example +971 50 123 4567.';

/**
 * [P46-4] A stored phone as the rep reads it: "+971 50 386 3103" for "+971503863103". A number stored before
 * validation without a country code is shown exactly as typed: the app never guesses one.
 */
export function displayPhone(stored: string | null | undefined): string {
  if (!stored) return '';
  const p = stored.trim().startsWith('+') ? parsePhoneNumberFromString(stored.trim()) : undefined;
  return p && p.isValid() ? p.formatInternational() : stored;
}

/** True when a stored number lacks a country code (so the field shows the fix). */
export function needsCountryCode(stored: string | null | undefined): boolean {
  return !!stored && !stored.trim().startsWith('+') && !stored.trim().startsWith('00');
}
