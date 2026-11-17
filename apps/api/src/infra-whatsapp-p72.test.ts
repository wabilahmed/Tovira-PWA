import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whatsappConfigFrom, activeNumber, whatsappAllowed } from './services/whatsapp/whatsapp-config.js';

/**
 * [P72-1 · owner] The API task gets all seven WhatsApp keys from tovira/prod/app, by the owner's names, and the plain
 * settings: WHATSAPP_MODE=test, WHATSAPP_INGEST_ENABLED=false, the allowlist (the owner's account only) and the two
 * display numbers. A fresh environment seeds the seven keys EMPTY, so WhatsApp stays unbuilt (404) until filled.
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(repo, p), 'utf8');
const SEVEN = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_TEST_NUMBER_ID', 'WHATSAPP_TEST_BUSINESS_ID', 'WHATSAPP_REAL_NUMBER_ID', 'WHATSAPP_REAL_BUSINESS_ID'];
const ecs = read('infra/terraform/ecs.tf');
const plain = (k: string): string | null => ecs.match(new RegExp(`\\{ name = "${k}", value = "([^"]*)" \\}`))?.[1] ?? null;

describe('[P72-1] ecs.tf', () => {
  it('maps all seven keys from the app secret, by these exact names', () => {
    for (const k of SEVEN) expect(ecs, k).toContain(`{ name = "${k}", valueFrom = "\${aws_secretsmanager_secret.app.arn}:${k}::" }`);
  });
  it('sets WHATSAPP_MODE=test and WHATSAPP_INGEST_ENABLED=false as plain settings (nothing switches on)', () => {
    expect(plain('WHATSAPP_MODE')).toBe('test');
    expect(plain('WHATSAPP_INGEST_ENABLED')).toBe('false');
  });
  it("the allowlist is the owner's account only", () => {
    expect(plain('WHATSAPP_ALLOWED_EMAILS')).toBe('wabil@tovira.io');
  });
  it('both display numbers are full numbers with a country code; test mode shows the +1 555 test number', () => {
    const env = Object.fromEntries(['WHATSAPP_MODE', 'WHATSAPP_INGEST_ENABLED', 'WHATSAPP_ALLOWED_EMAILS', 'WHATSAPP_TEST_DISPLAY_NUMBER', 'WHATSAPP_REAL_DISPLAY_NUMBER'].map((k) => [k, plain(k) ?? '']));
    const test = whatsappConfigFrom(env);
    expect(activeNumber(test).displayNumber).toMatch(/^\+1555\d{7}$/);
    expect(activeNumber(whatsappConfigFrom({ ...env, WHATSAPP_MODE: 'real' })).displayNumber).toMatch(/^\+971\d{8,9}$/);
    expect(test.enabled).toBe(false);
    expect(whatsappAllowed(test, 'wabil@tovira.io')).toBe(true);
    expect(whatsappAllowed(test, 'someone@example.com')).toBe(false);
  });
  it('NEGATIVE: no WhatsApp key is a plain setting, and no secret value is in the repo', () => {
    for (const k of SEVEN) expect(plain(k), k).toBeNull();
  });
});

describe('[P72-1] a fresh environment', () => {
  it('seeds the seven keys empty (WhatsApp stays unbuilt until they are filled), never a guessable placeholder', () => {
    const rc = read('infra/terraform/runtime-config.tf');
    for (const k of SEVEN) expect(rc, k).toMatch(new RegExp(`\\n\\s*${k}\\s*=\\s*""`));
  });
});
