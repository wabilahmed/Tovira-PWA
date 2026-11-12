import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';
import { MediaTooLargeError, type WhatsAppGraph } from '../ports/whatsapp.js';
import { InMemoryWhatsAppLinkStore } from '../adapters/whatsapp/in-memory-whatsapp-store.js';
import { WhatsAppService, LINK_CODE_TTL_MS } from '../services/whatsapp/whatsapp-service.js';
import { REPLY } from '../services/whatsapp/copy.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';
import { LONG_CHAT_MAX_MESSAGES } from '../services/import/long-chat.js';

// [P69 · owner] "Reading…" → "Analysing…" everywhere (one voice): the pinned wording below changed by owner decision.

/**
 * [P67 · owner] Send a chat export to Tovira's WhatsApp number (built dark). A rep links their number with a one-time
 * code sent FROM that number, then sends an exported chat as a file. Tovira downloads it, checks it with the same
 * decoder and parser as "Choose the chat export", stages it like a one-file upload and replies with the confirm link.
 * Nothing is read until the rep confirms who it's with. Everything else stores nothing.
 */
const APP_SECRET = 'test-app-secret';
const VERIFY = 'test-verify-token';
const TOVIRA = '+971500000001';
const REP_PHONE = '+971501234567';

let server: Server; let base: string; let deps: TestDeps;
let store: InMemoryWhatsAppLinkStore; let service: WhatsAppService;
let now = Date.UTC(2026, 10, 9, 10, 0, 0);
const sent: Array<{ to: string | null | undefined; body: string }> = [];
const media = new Map<string, Uint8Array>();
let modelCalls = 0;
const inactive = new Set<string>();
const graph: WhatsAppGraph = {
  mediaUrl: async (id) => { if (!media.has(id)) throw new Error('gone'); return { url: `https://media.example/${id}`, fileSize: media.get(id)!.length, mimeType: null }; },
  download: async (url, max) => { const b = media.get(url.split('/').pop()!)!; if (b.length > max) throw new MediaTooLargeError(); return b; },
  sendText: async (to, body) => { sent.push({ to: to.phone ?? to.waUserId, body }); },
};
const model: ModelClient = { complete: async () => { modelCalls += 1; return { text: JSON.stringify({ summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }; } };

function wire(on = true): void {
  store = new InMemoryWhatsAppLinkStore();
  service = new WhatsAppService({
    settings: { businessNumber: TOVIRA, appBaseUrl: 'https://tovira.io' },
    store, graph, storage: deps.storage,
    entitlement: async (u, n) => (inactive.has(u) ? { entitled: false, status: 'trial_expired' } : deps.billing!.entitlement(u, n)),
    longChatLimit: deps.longChatLimit ?? null,
    unlinkedReplies: new FixedWindowRateLimiter(1, 86_400_000),
    helpReplies: new FixedWindowRateLimiter(3, 3_600_000),
    perRep: new FixedWindowRateLimiter(30, 3_600_000),
    now: () => now,
  });
  deps.whatsapp = on ? { service, appSecret: APP_SECRET, verifyToken: VERIFY } : undefined;
}
beforeEach(async () => {
  sent.length = 0; media.clear(); modelCalls = 0; inactive.clear(); now = Date.UTC(2026, 10, 9, 10, 0, 0);
  deps = buildInMemoryDeps({}, { modelClient: model });
  wire();
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

// ---------- helpers ----------
async function rep(email = 'rep@example.com'): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
let seq = 0;
function payload(from: string | null, message: Record<string, unknown>, id = `wamid.${++seq}`, waUserId: string | null = null): string {
  return JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: TOVIRA.slice(1), phone_number_id: 'PNID' },
    contacts: [{ profile: { name: 'Rep' }, ...(from ? { wa_id: from.slice(1) } : {}), ...(waUserId ? { user_id: waUserId } : {}) }],
    messages: [{ id, ...(from ? { from: from.slice(1) } : {}), ...(waUserId ? { from_user_id: waUserId } : {}), timestamp: '1762682400', ...message }],
  } }] }] });
}
async function deliver(raw: string, signature = sign(raw)): Promise<Response> {
  const res = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw });
  await service.idle();
  return res;
}
const text = (from: string | null, body: string, id?: string, waUserId: string | null = null) => deliver(payload(from, { type: 'text', text: { body } }, id, waUserId));
function document(from: string, fileName: string, bytes: Uint8Array, id?: string): Promise<Response> {
  const mediaId = `m${++seq}`;
  media.set(mediaId, bytes);
  return deliver(payload(from, { type: 'document', document: { id: mediaId, filename: fileName, mime_type: fileName.endsWith('.zip') ? 'application/zip' : 'text/plain', sha256: 'x' } }, id));
}
async function linkNumber(token: string, phone = REP_PHONE): Promise<void> {
  const r = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone }) })).json()) as { code: string };
  await text(phone, `LINK ${r.code}`);
}
const status = async (token: string) => (await (await fetch(`${base}/whatsapp/link`, { headers: auth(token) })).json()) as { linked: { phone: string } | null; businessNumber: string };

// Fixtures: an Android export (.txt) and an iPhone export (.zip with _chat.txt), Anjali Mehra and the rep Wabil.
const ANDROID = [
  '15/01/2026, 09:12 - Anjali Mehra: Morning! Did the revised quote come through?',
  '15/01/2026, 09:40 - Wabil: Sending it over today, and the floor plan by Friday.',
  '15/01/2026, 10:02 - Anjali Mehra: Great, my husband wants to see it too.',
].join('\n');
const IPHONE = [
  '[15/01/2026, 09:12:03] Anjali Mehra: Morning! Did the revised quote come through?',
  '[15/01/2026, 09:40:11] Wabil: Sending it over today, and the floor plan by Friday.',
  '[15/01/2026, 10:02:45] Anjali Mehra: Great, my husband wants to see it too.',
].join('\n');
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
function zipOf(name: string, data: Buffer): Uint8Array {
  const nameBuf = Buffer.from(name, 'utf8');
  const lfh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data]);
  const cdr = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), nameBuf]);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cdr.length), u32(lfh.length), u16(0)]);
  return new Uint8Array(Buffer.concat([lfh, cdr, eocd]));
}
const androidTxt = () => new TextEncoder().encode(ANDROID);
const iphoneZip = () => zipOf('_chat.txt', Buffer.from(IPHONE));
const staged = async (userId: string) => (await deps.storage.list(`bulk-import/${userId}/`)).filter((k) => /\/f\d+\.json$/.test(k));
const batchFromReply = (body: string) => /import=([^\s&]+)/.exec(body)?.[1] ?? null;

// ---------- tests ----------
describe('[P67] the webhook signature', () => {
  it('a valid signature is accepted; an invalid or missing one is refused and nothing happens', async () => {
    const raw = payload('+971509999999', { type: 'text', text: { body: 'hi' } });
    expect((await deliver(raw, sign(raw, 'wrong-secret'))).status).toBe(401);
    expect((await deliver(raw, '')).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await deliver(raw)).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('a repeat delivery of the same message id is ignored', async () => {
    await text('+971509999999', 'hi', 'wamid.same');
    await text('+971509999999', 'hi', 'wamid.same');
    expect(sent).toHaveLength(1);
  });

  it('the subscribe handshake answers the challenge only with the right verify token', async () => {
    const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`)).status).toBe(403);
  });
});

describe('[P67] linking a number (no SMS)', () => {
  it('the right code from that number links it; Settings shows it; no reply is sent', async () => {
    const { token } = await rep();
    const start = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+971 50 123 4567' }) })).json()) as { code: string; waLink: string; phone: string };
    expect(start.phone).toBe(REP_PHONE);
    expect(start.code).toMatch(/^\d{6}$/);
    expect(start.waLink).toBe(`https://wa.me/971500000001?text=LINK%20${start.code}`);
    await text(REP_PHONE, `LINK ${start.code}`);
    expect((await status(token)).linked?.phone).toBe(REP_PHONE);
    expect(sent).toEqual([]);
  });

  it('a wrong code does not link, and says so', async () => {
    const { token } = await rep();
    await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) });
    await text(REP_PHONE, 'LINK 000000');
    expect((await status(token)).linked).toBeNull();
    expect(sent.map((s) => s.body)).toEqual([REPLY.wrongCode]);
  });

  it('the right code from ANOTHER number does not link (only that number proves it)', async () => {
    const { token } = await rep();
    const { code } = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) })).json()) as { code: string };
    await text('+971509999999', `LINK ${code}`);
    expect((await status(token)).linked).toBeNull();
  });

  it('an expired code (over 15 minutes) does not link', async () => {
    const { token } = await rep();
    const { code } = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) })).json()) as { code: string };
    now += LINK_CODE_TTL_MS + 1;
    await text(REP_PHONE, `LINK ${code}`);
    expect((await status(token)).linked).toBeNull();
    expect(sent.map((s) => s.body)).toEqual([REPLY.wrongCode]);
  });

  it('a code works once', async () => {
    const { token } = await rep();
    const { code } = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) })).json()) as { code: string };
    await text(REP_PHONE, `LINK ${code}`);
    await fetch(`${base}/whatsapp/link`, { method: 'DELETE', headers: auth(token) });
    await text(REP_PHONE, `LINK ${code}`);
    expect((await status(token)).linked).toBeNull();
  });

  it('a number linked to one account cannot be linked to another', async () => {
    const a = await rep('a@example.com');
    await linkNumber(a.token);
    const b = await rep('b@example.com');
    const res = await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(b.token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toBe('This number is linked to another Tovira account.');
    expect((await status(a.token)).linked?.phone).toBe(REP_PHONE);
  });

  it('one number per rep: linking a new number replaces the old one; unlinking removes it', async () => {
    const { token } = await rep();
    await linkNumber(token);
    await linkNumber(token, '+971507777777');
    expect((await status(token)).linked?.phone).toBe('+971507777777');
    expect(await store.byPhone(REP_PHONE)).toBeNull();
    await fetch(`${base}/whatsapp/link`, { method: 'DELETE', headers: auth(token) });
    expect((await status(token)).linked).toBeNull();
  });

  it('a number without a country code is refused with the fix', async () => {
    const { token } = await rep();
    const res = await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: '050 123 4567' }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Add the country code, for example +971 50 123 4567.');
  });
});

describe('[P67] receiving a chat', () => {
  it('an unlinked number: one reply ("isn\'t linked"), rate-limited, and nothing stored', async () => {
    await document('+971509999999', 'WhatsApp Chat with Anjali Mehra.txt', androidTxt());
    await document('+971509999999', 'WhatsApp Chat with Anjali Mehra.txt', androidTxt());
    expect(sent.map((s) => s.body)).toEqual([REPLY.notLinked]);
    expect(await deps.storage.list('bulk-import/')).toEqual([]);
  });

  it('a file that is not an export is refused with the export steps, and nothing is stored', async () => {
    const { token, userId } = await rep();
    await linkNumber(token);
    await document(REP_PHONE, 'notes.txt', new TextEncoder().encode('shopping list: milk, eggs'));
    expect(sent.map((s) => s.body)).toEqual([REPLY.notAnExport]);
    expect(await staged(userId)).toEqual([]);
  });

  for (const [label, fileName, bytes] of [
    ['Android (.txt)', 'WhatsApp Chat with Anjali Mehra.txt', androidTxt],
    ['iPhone (.zip)', 'WhatsApp Chat - Anjali Mehra.zip', iphoneZip],
  ] as const) {
    it(`${label}: staged, the reply names the chat and links to the confirm step, and NOTHING is read before confirming`, async () => {
      const { token, userId } = await rep();
      await linkNumber(token);
      await document(REP_PHONE, fileName, bytes());
      expect(sent).toHaveLength(1);
      const batchId = batchFromReply(sent[0]!.body)!;
      expect(sent[0]!.body).toBe(REPLY.gotChat('Anjali Mehra', `https://tovira.io/app?import=${batchId}`));
      expect(await staged(userId)).toHaveLength(1);
      // Not read: no client, no note, no model call, until the rep confirms.
      expect(await deps.clients.listByUser(userId)).toEqual([]);
      expect(await deps.notes.listPendingByUser(userId)).toEqual([]);
      expect(modelCalls).toBe(0);
      // The confirm step (the import review) sees it like any upload.
      const parsed = (await (await fetch(`${base}/import/bulk/parse`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ batchId, repName: 'Wabil' }) })).json()) as { result: { rows: Array<{ state: string; counterpart: string }> } };
      expect(parsed.result.rows).toEqual([expect.objectContaining({ state: 'new', counterpart: 'Anjali Mehra' })]);
      expect(modelCalls).toBe(0);
    });
  }

  it('after confirming, the import is byte for byte the "Choose the chat export" import', async () => {
    const viaWa = await rep('wa@example.com');
    await linkNumber(viaWa.token);
    await document(REP_PHONE, 'WhatsApp Chat - Anjali Mehra.zip', iphoneZip());
    const waBatch = batchFromReply(sent[0]!.body)!;
    const viaUpload = await rep('upload@example.com');
    const up = await fetch(`${base}/import/bulk/files`, { method: 'POST', headers: { ...auth(viaUpload.token), 'content-type': 'application/octet-stream', 'x-tovira-batch-id': 'u1', 'x-tovira-index': '0', 'x-tovira-name': encodeURIComponent('WhatsApp Chat - Anjali Mehra.zip') }, body: iphoneZip() });
    expect(up.status).toBe(200);
    const readNote = async (who: { token: string; userId: string }, batchId: string) => {
      await fetch(`${base}/import/bulk/parse`, { method: 'POST', headers: { ...auth(who.token), 'content-type': 'application/json' }, body: JSON.stringify({ batchId, repName: 'Wabil' }) });
      const res = await fetch(`${base}/import/bulk`, { method: 'POST', headers: { ...auth(who.token), 'content-type': 'application/json' }, body: JSON.stringify({ batchId, firstImportAck: true, decisions: [{ fileName: 'WhatsApp Chat - Anjali Mehra.zip', action: 'new', name: 'Anjali Mehra' }] }) });
      expect(res.status).toBe(202);
      for (let i = 0; i < 100; i += 1) {
        const [c] = await deps.clients.listByUser(who.userId);
        const n = c ? (await deps.notes.listByClient(who.userId, c.id))[0] : undefined;
        if (n) return { rawText: n.rawText, messages: n.messages, source: n.source };
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('never imported');
    };
    const a = await readNote(viaWa, waBatch);
    const b = await readNote(viaUpload, 'u1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.messages).toHaveLength(3);
  });

  it('a voice note, an image, a text or anything else: a one-line help reply, nothing stored', async () => {
    const { token, userId } = await rep();
    await linkNumber(token);
    await deliver(payload(REP_PHONE, { type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg; codecs=opus', voice: true } }));
    await text(REP_PHONE, 'hello?');
    expect(sent.map((s) => s.body)).toEqual([REPLY.unsupported, REPLY.help]);
    expect(await staged(userId)).toEqual([]);
  });

  it('a file Meta marks unsupported (it may be an iPhone .zip) gets the steps and the in-app upload as the way out', async () => {
    const { token } = await rep();
    await linkNumber(token);
    await deliver(payload(REP_PHONE, { type: 'unsupported', unsupported: { type: 'document' }, errors: [{ code: 131051 }] }));
    expect(sent.map((s) => s.body)).toEqual([REPLY.unsupported]);
    expect(REPLY.unsupported).toContain('upload it in Tovira instead');
  });

  it('an account whose trial is over: told why, with a link; nothing stored', async () => {
    const { token, userId } = await rep();
    await linkNumber(token);
    inactive.add(userId);
    await document(REP_PHONE, 'WhatsApp Chat with Anjali Mehra.txt', androidTxt());
    expect(sent.map((s) => s.body)).toEqual([REPLY.inactive('trial_expired', 'https://tovira.io')]);
    expect(sent[0]!.body).toContain('https://tovira.io/app?view=subscription');
    expect(await staged(userId)).toEqual([]);
  });

  it('a file over the upload limit is refused without being stored', async () => {
    const { token, userId } = await rep();
    await linkNumber(token);
    await document(REP_PHONE, 'WhatsApp Chat with Anjali Mehra.txt', new Uint8Array(10_000_001));
    expect(sent.map((s) => s.body)).toEqual([REPLY.tooLarge]);
    expect(await staged(userId)).toEqual([]);
  });

  it('a sender identified only by their WhatsApp user id (a username, no number) is matched once linked', async () => {
    const { token, userId } = await rep();
    // linked from their number first; WhatsApp tells us their user id too
    const { code } = (await (await fetch(`${base}/whatsapp/link`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ phone: REP_PHONE }) })).json()) as { code: string };
    await text(REP_PHONE, `LINK ${code}`, undefined, 'AE.123456');
    const mediaId = 'mu1';
    media.set(mediaId, androidTxt());
    await deliver(payload(null, { type: 'document', document: { id: mediaId, filename: 'WhatsApp Chat with Anjali Mehra.txt', mime_type: 'text/plain' } }, undefined, 'AE.123456'));
    expect(await staged(userId)).toHaveLength(1);
  });

  it('with windowing off, the long-chat rule applies here too: refused, nothing stored', async () => {
    const { token, userId } = await rep();
    await linkNumber(token);
    const lines = Array.from({ length: LONG_CHAT_MAX_MESSAGES + 1 }, (_, i) => `15/01/2026, 09:${String(i % 60).padStart(2, '0')} - ${i % 2 ? 'Wabil' : 'Anjali Mehra'}: m${i}`);
    await document(REP_PHONE, 'WhatsApp Chat with Anjali Mehra.txt', new TextEncoder().encode(lines.join('\n')));
    expect(sent[0]!.body).toMatch(/^This chat is too long to analyse in one go: 5,001 messages/);
    expect(await staged(userId)).toEqual([]);
  });
});

describe('[P67] switched off', () => {
  it('the webhook and the Settings routes do not exist (404), and nothing is handled', async () => {
    wire(false);
    const { token } = await rep();
    const raw = payload(REP_PHONE, { type: 'text', text: { body: 'hi' } });
    expect((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw })).status).toBe(404);
    expect((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status).toBe(404);
    expect((await fetch(`${base}/whatsapp/link`, { headers: auth(token) })).status).toBe(404);
    expect(sent).toEqual([]);
  });
});
