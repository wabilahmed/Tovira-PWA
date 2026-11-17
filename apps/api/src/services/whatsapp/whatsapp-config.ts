/**
 * [P72-1 · owner] WhatsApp settings, read by the exact names the owner put in tovira/prod/app:
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN,
 *   WHATSAPP_TEST_NUMBER_ID, WHATSAPP_TEST_BUSINESS_ID, WHATSAPP_REAL_NUMBER_ID, WHATSAPP_REAL_BUSINESS_ID
 * plus plain settings in the task:
 *   WHATSAPP_MODE                  test | real (default test): which number ID, business ID and display number to use
 *   WHATSAPP_INGEST_ENABLED        "true" switches ingest on; anything else is off
 *   WHATSAPP_TEST_DISPLAY_NUMBER / WHATSAPP_REAL_DISPLAY_NUMBER   the number reps see (wa.me link, Save contact)
 *   WHATSAPP_ALLOWED_EMAILS        who may see or link it, comma-separated; unset or empty = nobody; "*" = everyone
 * None of the values is ever logged.
 */
export type WhatsAppMode = 'test' | 'real';
export interface WhatsAppNumber { phoneNumberId: string; businessId: string; displayNumber: string }
export interface WhatsAppConfig {
  enabled: boolean;
  mode: WhatsAppMode;
  /** The raw WHATSAPP_MODE when it is neither test nor real (a boot problem); null when fine. */
  badMode: string | null;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  numbers: Record<WhatsAppMode, { phoneNumberId: string; businessId: string; displayRaw: string }>;
  allowedEmails: string[] | '*';
}

type Env = Record<string, string | undefined>;
// Read as env.NAME so the P46/P52 guard (every secret-named key read is mapped in ecs.tf) sees each one.
const t = (x: string | undefined): string => (x ?? '').trim();

export function whatsappConfigFrom(env: Env): WhatsAppConfig {
  const rawMode = t(env.WHATSAPP_MODE).toLowerCase();
  const mode: WhatsAppMode = rawMode === 'real' ? 'real' : 'test';
  const allowRaw = t(env.WHATSAPP_ALLOWED_EMAILS);
  return {
    enabled: t(env.WHATSAPP_INGEST_ENABLED).toLowerCase() === 'true',
    mode,
    badMode: rawMode === '' || rawMode === 'test' || rawMode === 'real' ? null : t(env.WHATSAPP_MODE),
    accessToken: t(env.WHATSAPP_ACCESS_TOKEN),
    appSecret: t(env.WHATSAPP_APP_SECRET),
    verifyToken: t(env.WHATSAPP_VERIFY_TOKEN),
    numbers: {
      test: { phoneNumberId: t(env.WHATSAPP_TEST_NUMBER_ID), businessId: t(env.WHATSAPP_TEST_BUSINESS_ID), displayRaw: t(env.WHATSAPP_TEST_DISPLAY_NUMBER) },
      real: { phoneNumberId: t(env.WHATSAPP_REAL_NUMBER_ID), businessId: t(env.WHATSAPP_REAL_BUSINESS_ID), displayRaw: t(env.WHATSAPP_REAL_DISPLAY_NUMBER) },
    },
    allowedEmails: allowRaw === '*' ? '*' : allowRaw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')),
  };
}

// Meta's test numbers are fictional +1 555 numbers that a full phone check rejects, so Tovira's own display number
// only needs a + and 8 to 15 digits (spaces, dashes and brackets dropped). Reps' numbers keep the full check.
const display = (raw: string): string | null => { const d = raw.replace(/[\s().-]/g, ''); return /^\+\d{8,15}$/.test(d) ? d : null; };

/** The number the current mode uses (display number in E.164; '' when not set or not a full number). */
export function activeNumber(c: WhatsAppConfig): WhatsAppNumber {
  const n = c.numbers[c.mode];
  return { phoneNumberId: n.phoneNumberId, businessId: n.businessId, displayNumber: display(n.displayRaw) ?? '' };
}

/** The webhook can exist (answer Meta's verify check, check signatures) once these three are set. */
export function whatsappKeysReady(c: WhatsAppConfig): boolean {
  return c.accessToken !== '' && c.appSecret !== '' && c.verifyToken !== '';
}

/** Boot problems: a bad mode always; with ingest on, every key and the current mode's number. */
export function whatsappProblems(c: WhatsAppConfig): string[] {
  const out: string[] = [];
  if (c.badMode !== null) out.push(`WHATSAPP_MODE (must be "test" or "real", got "${c.badMode}")`);
  for (const [k, raw] of [['TEST', c.numbers.test.displayRaw], ['REAL', c.numbers.real.displayRaw]] as const) {
    if (raw !== '' && display(raw) === null) out.push(`WHATSAPP_${k}_DISPLAY_NUMBER (a full number with its country code, e.g. +1 555 …)`);
  }
  if (!c.enabled) return out;
  const on = 'WHATSAPP_INGEST_ENABLED=true';
  if (!c.accessToken) out.push(`WHATSAPP_ACCESS_TOKEN (${on})`);
  if (!c.appSecret) out.push(`WHATSAPP_APP_SECRET (${on})`);
  if (!c.verifyToken) out.push(`WHATSAPP_VERIFY_TOKEN (${on})`);
  const M = c.mode.toUpperCase();
  const n = c.numbers[c.mode];
  if (!n.phoneNumberId) out.push(`WHATSAPP_${M}_NUMBER_ID (${on}, WHATSAPP_MODE=${c.mode})`);
  if (!n.businessId) out.push(`WHATSAPP_${M}_BUSINESS_ID (${on}, WHATSAPP_MODE=${c.mode})`);
  if (!n.displayRaw) out.push(`WHATSAPP_${M}_DISPLAY_NUMBER (${on}, WHATSAPP_MODE=${c.mode})`);
  return out;
}

/** Who may see "Send chats on WhatsApp" and link a number. Fail closed: no list = nobody. */
export function whatsappAllowed(c: WhatsAppConfig, email: string | null | undefined): boolean {
  if (c.allowedEmails === '*') return true;
  if (!email) return false;
  return c.allowedEmails.includes(email.trim().toLowerCase());
}
