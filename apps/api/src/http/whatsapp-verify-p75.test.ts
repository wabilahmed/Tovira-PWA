import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { WhatsAppGraph } from '../ports/whatsapp.js';
import { InMemoryWhatsAppLinkStore } from '../adapters/whatsapp/in-memory-whatsapp-store.js';
import { WhatsAppService, LINK_CODE_TTL_MS } from '../services/whatsapp/whatsapp-service.js';
import { REPLY } from '../services/whatsapp/copy.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';

/**
 * [P75 · owner] Beta request: capture the WhatsApp number, verify it after approval.
 * The request form takes a required WhatsApp number, stored in E.164. Once approved, the rep verifies with the P67 flow
 * (a wa.me link with "LINK <code>" to Tovira's number, 15 minutes, single use), the number pre-filled from the request.
 * A code that arrives from the same number verifies and links it. A code that arrives from a DIFFERENT number links
 * nothing: the rep is asked to confirm that new number, and only the number they sent from can ever be linked.
 * A new code voids the old one. Admin → Access shows the number on the request and each account's status.
 */
const APP_SECRET = 'test-app-secret';
const TOVIRA = '+971500000001';
const REQUESTED = '+971501234567';
const OTHER = '+447911123456';
const STRANGER = '+919800000001';

let server: Server; let base: string; let deps: TestDeps;
let store: InMemoryWhatsAppLinkStore; let service: WhatsAppService;
let now = Date.UTC(2026, 10, 18, 10, 0, 0);
const sent: Array<{ to: string | null | undefined; body: string }> = [];
const graph: WhatsAppGraph = {
  mediaUrl: async () => { throw new Error('no media in these tests'); },
  download: async () => new Uint8Array(),
  sendText: async (to, body) => { sent.push({ to: to.phone ?? to.waUserId, body }); },
};

beforeEach(async () => {
  sent.length = 0; now = Date.UTC(2026, 10, 18, 10, 0, 0);
  deps = buildInMemoryDeps();
  store = new InMemoryWhatsAppLinkStore();
  service = new WhatsAppService({
    settings: { businessNumber: TOVIRA, appBaseUrl: 'https://tovira.io' },
    store, graph, storage: deps.storage,
    entitlement: async () => ({ entitled: true, status: 'trialing' }),
    requestedNumber: async (u) => (await deps.accessRequests.findByLinkedUser(u))?.whatsappNumber ?? null,
    linkGuesses: new FixedWindowRateLimiter(5, 3_600_000),
    now: () => now,
  });
  deps.whatsapp = { service, appSecret: APP_SECRET, verifyToken: 'v', enabled: true, allowed: () => true };
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

// ---------- helpers ----------
const REQ = {
  fullName: 'Dana Rep', workEmail: 'dana@example.ae', phone: '+971 50 123 4567', companyName: 'Meridian', roleTitle: 'Advisor',
  ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: '50_200', industry: 'insurance', confirmationAccepted: true,
};
const submit = (body: Record<string, unknown>) => fetch(`${base}/access-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const sign = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
let seq = 0;
async function text(from: string, body: string): Promise<void> {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: TOVIRA.slice(1), phone_number_id: 'PNID' },
    contacts: [{ profile: { name: 'Rep' }, wa_id: from.slice(1) }],
    messages: [{ id: `wamid.p75.${++seq}`, from: from.slice(1), timestamp: '1763460000', type: 'text', text: { body } }],
  } }] }] });
  await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
  await service.idle();
}
/** An approved rep: their request (with the WhatsApp number) is linked to their account, as approval does. */
async function approvedRep(email = 'dana@example.ae', whatsappNumber: string | null = REQUESTED): Promise<{ token: string; userId: string; requestId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const r = await deps.accessRequests.create({
    fullName: 'Dana Rep', workEmail: email, phone: '+971501234567', companyName: 'Meridian', roleTitle: 'Advisor', ownership: 'employed', tradeLicenceNumber: null,
    conversationOwnership: 'own_clients', conversationOwnershipOther: null, expectedVolume: '50_200', confirmationAcceptedAt: now, confirmationTextVersion: 'v1',
    sourceIp: null, userAgent: null, referralCode: null, industry: 'insurance', whatsappNumber,
  });
  await deps.accessRequests.review(r.id, { status: 'activated', reviewedAt: now, linkedUserId: b.user.id });
  return { token: b.token, userId: b.user.id, requestId: r.id };
}
type Status = { linked: { phone: string; linkedAt: number } | null; businessNumber: string; requestedNumber: string | null; awaitingConfirm: { phone: string } | null };
const status = async (token: string) => (await (await fetch(`${base}/whatsapp/link`, { headers: auth(token) })).json()) as Status;
async function verifyNow(token: string, phone = REQUESTED): Promise<{ code: string; waLink: string; phone: string; expiresAt: number }> {
  const res = await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
  expect(res.status).toBe(200);
  return (await res.json()) as { code: string; waLink: string; phone: string; expiresAt: number };
}
const confirm = (token: string, accept: boolean) => fetch(`${base}/whatsapp/link/confirm`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ accept }) });

// ---------- 1. the request form ----------
describe('[P75] the request form: a required WhatsApp number, validated, stored in E.164', () => {
  it('a valid number with its country code is stored in E.164 and shown to the admin with the request', async () => {
    const res = await submit({ ...REQ, whatsappNumber: '+971 50 123 4567' });
    expect(res.status).toBe(201);
    const [row] = await deps.accessRequests.list();
    expect(row!.whatsappNumber).toBe('+971501234567');
    const res2 = await submit({ ...REQ, workEmail: 'b@example.ae', whatsappNumber: '0044 7911 123456' }); // 00 = the international prefix
    expect(res2.status).toBe(201);
    expect((await deps.accessRequests.list())[0]!.whatsappNumber).toBe('+447911123456');
  });

  for (const [label, value] of [['missing', undefined], ['empty', '  '], ['not a number', 'call me'], ['no country code', '050 123 4567'], ['too short for its country', '+971 50 12'], ['not text', 971501234567]] as const) {
    it(`NEGATIVE: ${label} is refused on the WhatsApp field, and nothing is written`, async () => {
      const res = await submit({ ...REQ, ...(value === undefined ? {} : { whatsappNumber: value }) });
      expect(res.status).toBe(400);
      const b = (await res.json()) as { field: string; message: string };
      expect(b.field).toBe('whatsappNumber');
      expect(b.message).toMatch(/WhatsApp number/);
      expect(b.message).not.toMatch(/\+971|UAE|United Arab Emirates/); // [owner] no default country in the copy
      expect(await deps.accessRequests.count()).toBe(0);
    });
  }
});

// ---------- 2. verifying after approval ----------
describe('[P75] verifying: the number from the request is pre-filled', () => {
  it('Settings status carries the requested number, not verified yet', async () => {
    const { token } = await approvedRep();
    expect(await status(token)).toMatchObject({ linked: null, requestedNumber: REQUESTED, awaitingConfirm: null });
  });

  it('a same-number verify: the code from the requested number links it, verified with the date, no reply sent', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    expect(v.waLink).toBe(`https://wa.me/971500000001?text=LINK%20${v.code}`);
    expect(v.expiresAt).toBe(now + LINK_CODE_TTL_MS);
    now += 60_000;
    await text(REQUESTED, `LINK ${v.code}`);
    const s = await status(token);
    expect(s.linked).toEqual({ phone: REQUESTED, linkedAt: now });
    expect(s.awaitingConfirm).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a different-number confirm: nothing is linked until the rep confirms, and then ONLY the number they sent from', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    await text(OTHER, `LINK ${v.code}`);
    let s = await status(token);
    expect(s.linked).toBeNull(); // never linked without the rep's confirmation
    expect(s.awaitingConfirm).toEqual({ phone: OTHER });
    expect(sent.map((m) => m.body)).toEqual([REPLY.confirmInApp]);
    const res = await confirm(token, true);
    expect(res.status).toBe(200);
    s = (await res.json()) as Status;
    expect(s.linked?.phone).toBe(OTHER); // the number the message came from
    expect(s.awaitingConfirm).toBeNull();
    expect(await store.byPhone(REQUESTED)).toBeNull(); // the number they did not send from is never linked
  });

  it('a different-number decline: nothing linked, the question goes away, the requested number stays unverified', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    await text(OTHER, `LINK ${v.code}`);
    const s = (await (await confirm(token, false)).json()) as Status;
    expect(s).toMatchObject({ linked: null, awaitingConfirm: null, requestedNumber: REQUESTED });
    expect(await store.byPhone(OTHER)).toBeNull();
  });

  it('NEGATIVE: confirming with nothing waiting links nothing (410)', async () => {
    const { token } = await approvedRep();
    await verifyNow(token);
    const res = await confirm(token, true);
    expect(res.status).toBe(410);
    expect((await status(token)).linked).toBeNull();
  });

  it('NEGATIVE: the confirmation itself expires after 15 minutes', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    await text(OTHER, `LINK ${v.code}`);
    now += LINK_CODE_TTL_MS + 1;
    expect((await status(token)).awaitingConfirm).toBeNull();
    expect((await confirm(token, true)).status).toBe(410);
    expect((await status(token)).linked).toBeNull();
  });

  it('NEGATIVE: a different number already linked to another account is refused, and nothing waits for confirmation', async () => {
    const a = await approvedRep('a@example.ae', OTHER);
    await text(OTHER, `LINK ${(await verifyNow(a.token, OTHER)).code}`);
    expect((await status(a.token)).linked?.phone).toBe(OTHER);
    const b = await approvedRep('b@example.ae');
    await text(OTHER, `LINK ${(await verifyNow(b.token)).code}`);
    expect(await status(b.token)).toMatchObject({ linked: null, awaitingConfirm: null });
    expect(sent.at(-1)!.body).toBe('This number is linked to another Tovira account.');
  });

  it('NEGATIVE: an expired code links nothing, from the same number or a different one', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    now += LINK_CODE_TTL_MS + 1;
    await text(REQUESTED, `LINK ${v.code}`);
    await text(OTHER, `LINK ${v.code}`);
    expect(await status(token)).toMatchObject({ linked: null, awaitingConfirm: null });
    expect(sent.map((m) => m.body)).toEqual([REPLY.wrongCode, REPLY.wrongCode]);
  });

  it('NEGATIVE: a code used twice: the second message (same or another number) does nothing', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    await text(REQUESTED, `LINK ${v.code}`);
    await text(REQUESTED, `LINK ${v.code}`);
    await text(OTHER, `LINK ${v.code}`);
    const s = await status(token);
    expect(s.linked?.phone).toBe(REQUESTED);
    expect(s.awaitingConfirm).toBeNull();
    expect(sent.map((m) => m.body)).toEqual([REPLY.wrongCode, REPLY.wrongCode]);
  });

  it('NEGATIVE: tapping Verify now again makes a new code and voids the old one', async () => {
    const { token } = await approvedRep();
    const first = await verifyNow(token);
    const second = await verifyNow(token);
    expect(second.code).not.toBe(first.code);
    await text(REQUESTED, `LINK ${first.code}`);
    await text(OTHER, `LINK ${first.code}`);
    expect(await status(token)).toMatchObject({ linked: null, awaitingConfirm: null });
    await text(REQUESTED, `LINK ${second.code}`);
    expect((await status(token)).linked?.phone).toBe(REQUESTED);
  });

  it('NEGATIVE: a new code also voids a confirmation that was waiting', async () => {
    const { token } = await approvedRep();
    await text(OTHER, `LINK ${(await verifyNow(token)).code}`);
    expect((await status(token)).awaitingConfirm).toEqual({ phone: OTHER });
    await verifyNow(token);
    expect((await status(token)).awaitingConfirm).toBeNull();
    expect((await confirm(token, true)).status).toBe(410);
  });

  it('NEGATIVE: a stranger guessing codes from their number gets 5 tries an hour; after that even a right code waits for nobody', async () => {
    const { token } = await approvedRep();
    const v = await verifyNow(token);
    for (let i = 0; i < 5; i++) await text(STRANGER, `LINK ${String(i).padStart(6, '9')}`);
    await text(STRANGER, `LINK ${v.code}`);
    expect(await status(token)).toMatchObject({ linked: null, awaitingConfirm: null });
    await text(REQUESTED, `LINK ${v.code}`); // the rep's own number is not affected by the stranger
    expect((await status(token)).linked?.phone).toBe(REQUESTED);
  });

  it('Change number: a code for a new number, sent from it, links it in place of the old one', async () => {
    const { token } = await approvedRep();
    await text(REQUESTED, `LINK ${(await verifyNow(token)).code}`);
    await text(OTHER, `LINK ${(await verifyNow(token, OTHER)).code}`);
    expect((await status(token)).linked?.phone).toBe(OTHER);
  });

  it('a rep with no number on their request (approved before P75) gets requestedNumber null', async () => {
    const { token } = await approvedRep('old@example.ae', null);
    expect((await status(token)).requestedNumber).toBeNull();
  });
});

// ---------- 3. Admin → Access ----------
describe('[P75] Admin → Access: the number on the request, each account\'s WhatsApp status', () => {
  it('a request shows its WhatsApp number; an account shows not verified, then verified with the date', async () => {
    const { cookie } = await signInAdmin(base, deps);
    await submit({ ...REQ, workEmail: 'new@example.ae', whatsappNumber: '+44 7911 123456' });
    const { token, requestId } = await approvedRep();
    type Row = { id: string; whatsappNumber: string | null; whatsapp?: { verified: boolean; phone: string | null; verifiedAt: number | null } | null };
    const list = async () => ((await (await fetch(`${base}/admin/access-requests`, { headers: { cookie } })).json()) as { requests: Row[] }).requests;
    let rows = await list();
    expect(rows.find((r) => r.whatsappNumber === '+447911123456')!.whatsapp ?? null).toBeNull(); // no account yet: no status
    expect(rows.find((r) => r.id === requestId)!.whatsapp).toEqual({ verified: false, phone: null, verifiedAt: null });
    await text(REQUESTED, `LINK ${(await verifyNow(token)).code}`);
    rows = await list();
    expect(rows.find((r) => r.id === requestId)!.whatsapp).toEqual({ verified: true, phone: REQUESTED, verifiedAt: now });
  });
});
