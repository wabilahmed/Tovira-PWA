import { describe, it, expect } from 'vitest';
import { whatsappConfigFrom } from './services/whatsapp/whatsapp-config.js';
import { buildWhatsApp } from './whatsapp-wiring.js';
import { InMemoryWhatsAppLinkStore } from './adapters/whatsapp/in-memory-whatsapp-store.js';
import { InMemoryStorage } from './adapters/storage/in-memory.js';

/**
 * [P72-1 · owner] What the API builds at boot from the WhatsApp settings. No keys: nothing (every path is a 404, as
 * before). Keys set: the webhook exists, with the current mode's number for Graph calls and for what reps are shown.
 */
const KEYS = {
  WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_APP_SECRET: 'sec', WHATSAPP_VERIFY_TOKEN: 'ver',
  WHATSAPP_TEST_NUMBER_ID: 'test-pnid', WHATSAPP_TEST_BUSINESS_ID: 'test-waba', WHATSAPP_TEST_DISPLAY_NUMBER: '+15550100000',
  WHATSAPP_REAL_NUMBER_ID: 'real-pnid', WHATSAPP_REAL_BUSINESS_ID: 'real-waba', WHATSAPP_REAL_DISPLAY_NUMBER: '+971500000000',
};
function build(env: Record<string, string>) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => { urls.push(url); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  const wa = buildWhatsApp(whatsappConfigFrom(env), {
    store: new InMemoryWhatsAppLinkStore(), storage: new InMemoryStorage(), appBaseUrl: 'https://tovira.io',
    entitlement: async () => ({ entitled: true, status: 'active' }), longChatLimit: null, fetchImpl,
  });
  return { wa, urls };
}

describe('[P72-1] boot wiring', () => {
  it('NEGATIVE: without the keys nothing is built (the routes stay 404)', () => {
    expect(build({}).wa).toBeUndefined();
    expect(build({ ...KEYS, WHATSAPP_VERIFY_TOKEN: '' }).wa).toBeUndefined();
  });
  it('test mode: replies go out from the test number, and reps are shown the test number', async () => {
    const { wa, urls } = build(KEYS);
    expect(wa!.enabled).toBe(false);
    expect((await wa!.service.status('u1')).businessNumber).toBe('+15550100000');
    await wa!.graph.sendText({ phone: '+15551230000' }, 'hi');
    expect(urls).toEqual(['https://graph.facebook.com/v27.0/test-pnid/messages']);
  });
  it('real mode: the real number, for both', async () => {
    const { wa, urls } = build({ ...KEYS, WHATSAPP_MODE: 'real', WHATSAPP_INGEST_ENABLED: 'true' });
    expect(wa!.enabled).toBe(true);
    expect((await wa!.service.status('u1')).businessNumber).toBe('+971500000000');
    await wa!.graph.sendText({ phone: '+15551230000' }, 'hi');
    expect(urls).toEqual(['https://graph.facebook.com/v27.0/real-pnid/messages']);
  });
  it('the allowlist travels with it', () => {
    const { wa } = build({ ...KEYS, WHATSAPP_ALLOWED_EMAILS: 'owner@example.com' });
    expect(wa!.allowed('owner@example.com')).toBe(true);
    expect(wa!.allowed('rep@example.com')).toBe(false);
  });
});
