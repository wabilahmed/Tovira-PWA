import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { WhatsAppGraph } from '../ports/whatsapp.js';
import { InMemoryWhatsAppLinkStore } from '../adapters/whatsapp/in-memory-whatsapp-store.js';
import { WhatsAppService } from '../services/whatsapp/whatsapp-service.js';
import { whatsappConfigFrom, whatsappAllowed } from '../services/whatsapp/whatsapp-config.js';

/**
 * [P72-1 · owner] WhatsApp step 1 (test number). Nothing switches on until the owner says so:
 *  - with the keys set and WHATSAPP_INGEST_ENABLED off, the webhook answers Meta's verify check (so it can be
 *    registered), but a delivered message is accepted and dropped: nothing stored, no reply, no download;
 *  - the Settings routes exist only when ingest is on AND the account is on the allowlist; everyone else gets the same
 *    404 as "switched off", so the web shows nothing.
 */
const APP_SECRET = 'test-app-secret';
const VERIFY = 'test-verify-token';
const OWNER = 'owner@example.com';
let server: Server; let base: string; let deps: TestDeps; let store: InMemoryWhatsAppLinkStore;
const calls: string[] = [];
const graph: WhatsAppGraph = {
  mediaUrl: async (id) => { calls.push(`media ${id}`); return { url: 'https://media.example/x', fileSize: 1, mimeType: null }; },
  download: async () => { calls.push('download'); return new Uint8Array(); },
  sendText: async (_to, body) => { calls.push(`reply ${body}`); },
};

async function start(env: Record<string, string>): Promise<void> {
  const cfg = whatsappConfigFrom({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY, WHATSAPP_TEST_NUMBER_ID: 'pnid', WHATSAPP_TEST_DISPLAY_NUMBER: '+15550100000', ...env });
  deps = buildInMemoryDeps({}, {});
  store = new InMemoryWhatsAppLinkStore();
  const service = new WhatsAppService({ settings: { businessNumber: '+15550100000', appBaseUrl: 'https://tovira.io' }, store, graph, storage: deps.storage, entitlement: async () => ({ entitled: true, status: 'active' }) });
  deps.whatsapp = { service, appSecret: APP_SECRET, verifyToken: VERIFY, enabled: cfg.enabled, allowed: (email) => whatsappAllowed(cfg, email) };
  server = createApiServer(deps);
  base = await listenForTest(server);
}
beforeEach(() => { calls.length = 0; });
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function rep(email: string): Promise<string> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string };
  return b.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const sign = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
const message = (from: string, body: Record<string, unknown>) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '15550100000', phone_number_id: 'pnid' }, contacts: [{ wa_id: from.slice(1) }],
  messages: [{ id: `wamid.${Math.random()}`, from: from.slice(1), timestamp: '1762682400', ...body }] } }] }] });
const verify = (token: string) => fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1158201444`);
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('[P72-1] keys set, ingest OFF (today)', () => {
  beforeEach(() => start({ WHATSAPP_ALLOWED_EMAILS: OWNER }));
  it("the webhook answers Meta's verify check with the verify token, and only with it", async () => {
    const ok = await verify(VERIFY);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    expect((await verify('wrong')).status).toBe(403);
  });
  it('NEGATIVE: a signed delivery is accepted and dropped: nothing stored, no reply, nothing downloaded', async () => {
    const raw = message('+15551230000', { type: 'text', text: { body: 'LINK 123456' } });
    expect((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw })).status).toBe(200);
    const doc = message('+15551230000', { type: 'document', document: { id: 'MEDIA1', filename: 'WhatsApp Chat with A.txt' } });
    await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': sign(doc) }, body: doc });
    await settle();
    expect(calls).toEqual([]);
    expect(await store.byPhone('+15551230000')).toBeNull();
  });
  it('NEGATIVE: an unsigned delivery is still refused', async () => {
    const raw = message('+15551230000', { type: 'text', text: { body: 'hi' } });
    expect((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: raw })).status).toBe(401);
  });
  it('NEGATIVE: Settings shows nothing, even to the allowlisted owner (404, as switched off)', async () => {
    const t = await rep(OWNER);
    expect((await fetch(`${base}/whatsapp/link`, { headers: auth(t) })).status).toBe(404);
    expect((await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: auth(t), body: JSON.stringify({ phone: '+15551230000' }) })).status).toBe(404);
  });
});

describe('[P72-1] ingest ON, allowlist = the owner only', () => {
  beforeEach(() => start({ WHATSAPP_INGEST_ENABLED: 'true', WHATSAPP_ALLOWED_EMAILS: OWNER }));
  it('the owner sees "Send chats on WhatsApp" (the status) and can start linking a number', async () => {
    const t = await rep(OWNER);
    const s = await fetch(`${base}/whatsapp/link`, { headers: auth(t) });
    expect(s.status).toBe(200);
    expect(await s.json()).toEqual({ linked: null, businessNumber: '+15550100000' });
    const l = await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: auth(t), body: JSON.stringify({ phone: '+971501234567' }) });
    expect(l.status).toBe(200);
    expect(((await l.json()) as { waLink: string }).waLink).toMatch(/^https:\/\/wa\.me\/15550100000\?text=LINK%20\d{6}$/);
  });
  it('NEGATIVE: everyone else gets the same 404 as switched off, for every Settings call, and can link nothing', async () => {
    const t = await rep('rep@example.com');
    expect((await fetch(`${base}/whatsapp/link`, { headers: auth(t) })).status).toBe(404);
    expect((await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: auth(t), body: JSON.stringify({ phone: '+15559990000' }) })).status).toBe(404);
    expect((await fetch(`${base}/whatsapp/link`, { method: 'DELETE', headers: auth(t) })).status).toBe(404);
    expect(await store.byPhone('+15559990000')).toBeNull();
  });
  it('NEGATIVE: signed out is still 401, not a hint that it exists for someone', async () => {
    expect((await fetch(`${base}/whatsapp/link`)).status).toBe(401);
  });
});

describe('[P72-1] ingest ON, no allowlist set', () => {
  beforeEach(() => start({ WHATSAPP_INGEST_ENABLED: 'true' }));
  it('NEGATIVE: nobody sees it (fail closed), the owner included', async () => {
    const t = await rep(OWNER);
    expect((await fetch(`${base}/whatsapp/link`, { headers: auth(t) })).status).toBe(404);
  });
});
