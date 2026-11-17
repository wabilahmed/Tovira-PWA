import { describe, it, expect } from 'vitest';
import { activeNumber, whatsappAllowed, whatsappConfigFrom, whatsappKeysReady, whatsappProblems } from './whatsapp-config.js';

/**
 * [P72-1 · owner] WhatsApp step 1. The seven keys in tovira/prod/app, read by these exact names; WHATSAPP_MODE (test |
 * real, default test) picks which number ID, business ID and display number Tovira uses; WHATSAPP_INGEST_ENABLED stays
 * a plain setting (off unless "true"); and an allowlist decides who may see or link it while testing.
 */
const KEYS = {
  WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_APP_SECRET: 'sec', WHATSAPP_VERIFY_TOKEN: 'ver',
  WHATSAPP_TEST_NUMBER_ID: 'test-pnid', WHATSAPP_TEST_BUSINESS_ID: 'test-waba',
  WHATSAPP_REAL_NUMBER_ID: 'real-pnid', WHATSAPP_REAL_BUSINESS_ID: 'real-waba',
  WHATSAPP_TEST_DISPLAY_NUMBER: '+1 555 010 0000', WHATSAPP_REAL_DISPLAY_NUMBER: '+971 50 000 0000',
};

describe('[P72-1] WHATSAPP_MODE picks the number', () => {
  it('test mode (the default) uses the test number ID, business ID and display number', () => {
    for (const env of [KEYS, { ...KEYS, WHATSAPP_MODE: 'test' }, { ...KEYS, WHATSAPP_MODE: ' TEST ' }]) {
      const c = whatsappConfigFrom(env);
      expect(c.mode).toBe('test');
      expect(activeNumber(c)).toEqual({ phoneNumberId: 'test-pnid', businessId: 'test-waba', displayNumber: '+15550100000' });
    }
  });
  it('real mode uses the real number ID, business ID and display number', () => {
    const c = whatsappConfigFrom({ ...KEYS, WHATSAPP_MODE: 'real' });
    expect(c.mode).toBe('real');
    expect(activeNumber(c)).toEqual({ phoneNumberId: 'real-pnid', businessId: 'real-waba', displayNumber: '+971500000000' });
  });
  it('NEGATIVE: any other mode is a boot problem, never a silent fallback to a number', () => {
    const c = whatsappConfigFrom({ ...KEYS, WHATSAPP_MODE: 'prod' });
    expect(whatsappProblems(c)).toContain('WHATSAPP_MODE (must be "test" or "real", got "prod")');
  });
});

describe('[P72-1] the keys and the switch', () => {
  it('reads the seven keys by their exact names; ingest is off unless WHATSAPP_INGEST_ENABLED is "true"', () => {
    const c = whatsappConfigFrom(KEYS);
    expect([c.accessToken, c.appSecret, c.verifyToken]).toEqual(['tok', 'sec', 'ver']);
    expect(whatsappKeysReady(c)).toBe(true);
    expect(c.enabled).toBe(false);
    for (const v of ['false', '1', 'yes', '', 'TRUE ']) expect(whatsappConfigFrom({ ...KEYS, WHATSAPP_INGEST_ENABLED: v }).enabled).toBe(v.trim().toLowerCase() === 'true');
  });
  it('off: nothing is required (a fresh environment boots with no WhatsApp keys at all)', () => {
    expect(whatsappProblems(whatsappConfigFrom({}))).toEqual([]);
    expect(whatsappKeysReady(whatsappConfigFrom({}))).toBe(false);
  });
  it('NEGATIVE: on, a missing key or the current mode\'s number is a boot problem', () => {
    const on = { ...KEYS, WHATSAPP_INGEST_ENABLED: 'true' };
    expect(whatsappProblems(whatsappConfigFrom(on))).toEqual([]);
    expect(whatsappProblems(whatsappConfigFrom({ ...on, WHATSAPP_APP_SECRET: '' }))).toContain('WHATSAPP_APP_SECRET (WHATSAPP_INGEST_ENABLED=true)');
    expect(whatsappProblems(whatsappConfigFrom({ ...on, WHATSAPP_MODE: 'real', WHATSAPP_REAL_NUMBER_ID: '' }))).toContain('WHATSAPP_REAL_NUMBER_ID (WHATSAPP_INGEST_ENABLED=true, WHATSAPP_MODE=real)');
    expect(whatsappProblems(whatsappConfigFrom({ ...on, WHATSAPP_TEST_DISPLAY_NUMBER: '555' }))).toContain('WHATSAPP_TEST_DISPLAY_NUMBER (a full number with its country code, e.g. +1 555 …)');
    // the other mode's number is not needed while it is not used
    expect(whatsappProblems(whatsappConfigFrom({ ...on, WHATSAPP_REAL_NUMBER_ID: '', WHATSAPP_REAL_DISPLAY_NUMBER: '' }))).toEqual([]);
  });
});

describe('[P72-1] the allowlist (who may see or link it while testing)', () => {
  it('only the listed accounts, case-insensitive', () => {
    const c = whatsappConfigFrom({ ...KEYS, WHATSAPP_ALLOWED_EMAILS: ' Owner@Example.com , second@example.com' });
    expect(whatsappAllowed(c, 'owner@example.com')).toBe(true);
    expect(whatsappAllowed(c, 'SECOND@example.com')).toBe(true);
    expect(whatsappAllowed(c, 'rep@example.com')).toBe(false);
    expect(whatsappAllowed(c, null)).toBe(false);
  });
  it('NEGATIVE: unset or empty means nobody (fail closed); only "*" opens it to everyone', () => {
    expect(whatsappAllowed(whatsappConfigFrom(KEYS), 'owner@example.com')).toBe(false);
    expect(whatsappAllowed(whatsappConfigFrom({ ...KEYS, WHATSAPP_ALLOWED_EMAILS: ' , ' }), 'owner@example.com')).toBe(false);
    expect(whatsappAllowed(whatsappConfigFrom({ ...KEYS, WHATSAPP_ALLOWED_EMAILS: '*' }), 'anyone@example.com')).toBe(true);
  });
});
