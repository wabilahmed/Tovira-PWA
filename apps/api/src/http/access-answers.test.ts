import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P46-6c.2] Owner: a request made from a hot lead was approved with blank answers. Before that rep uses the app they
 * answer the questions the form would have asked (phone, ownership, whose conversations, volume, industry) and tick the
 * confirmation. The confirmation is not optional for anyone: until it is ticked the server refuses every import,
 * paste and voice note. A form sign-up who already answered never sees this.
 */
let server: Server;
let base: string;
let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps({ signupEnabled: true });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const BLANK = { phone: null, ownership: null, tradeLicenceNumber: null, conversationOwnership: null, conversationOwnershipOther: null, expectedVolume: null, confirmationAcceptedAt: null, confirmationTextVersion: null, industry: null, industryOther: null, sourceIp: null, userAgent: null, referralCode: null };
async function rep(email: string, source: 'hot_lead' | 'form' | 'none') {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  if (source !== 'none') {
    const req = await deps.accessRequests.create(source === 'hot_lead'
      ? { ...BLANK, fullName: 'Dana Lead', workEmail: email, companyName: 'Acme', roleTitle: 'Sales', source: 'hot_lead' }
      : { ...BLANK, fullName: 'Dana Form', workEmail: email, companyName: 'Acme', roleTitle: 'Sales', phone: '+971500000000', ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: 'under_50', confirmationAcceptedAt: Date.now(), confirmationTextVersion: 'v1', industry: 'insurance', source: 'form' });
    await deps.accessRequests.review(req.id, { status: 'activated', reviewedAt: Date.now(), linkedUserId: b.user.id });
  }
  const H = { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' };
  const client = (await (await fetch(`${base}/clients`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Sara' }) })).json()) as { id: string };
  return { H, clientId: client.id };
}
const status = async (H: Record<string, string>) => (await (await fetch(`${base}/me/access-answers`, { headers: H })).json()) as { required: boolean; missing: string[] };
const paste = (r: { H: Record<string, string>; clientId: string }) => fetch(`${base}/clients/${r.clientId}/notes/paste`, { method: 'POST', headers: r.H, body: JSON.stringify({ text: 'hi there, I will send the plan' }) });
const importChat = (r: { H: Record<string, string>; clientId: string }) => fetch(`${base}/clients/${r.clientId}/notes/import`, { method: 'POST', headers: { ...r.H, 'content-type': 'text/plain' }, body: '[1/1/26, 10:00:00] Sara: hello' });
const ANSWERS = { phone: '+971 50 386 3103', ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: 'under_50', industry: 'insurance' };

describe('[P46-6c.2] hot-lead invitees answer the blank questions first', () => {
  it('a hot-lead rep is asked for the blank answers and the confirmation', async () => {
    const r = await rep('hl1@example.com', 'hot_lead');
    expect(await status(r.H)).toEqual({ required: true, missing: ['phone', 'ownership', 'conversationOwnership', 'expectedVolume', 'industry', 'confirmation'] });
  });

  it('NEGATIVE: until the confirmation is ticked, a chat import, a paste and a voice note are refused (403)', async () => {
    const r = await rep('hl2@example.com', 'hot_lead');
    for (const res of [await importChat(r), await paste(r), await fetch(`${base}/clients/${r.clientId}/notes/voice`, { method: 'POST', headers: { ...r.H, 'content-type': 'audio/webm' }, body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) })]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('answers_required');
    }
    const bulk = await fetch(`${base}/import/bulk`, { method: 'POST', headers: r.H, body: JSON.stringify({}) });
    expect(bulk.status).toBe(403);
  });

  it('NEGATIVE: answers without the confirmation are refused, and the rep is still asked', async () => {
    const r = await rep('hl3@example.com', 'hot_lead');
    const res = await fetch(`${base}/me/access-answers`, { method: 'POST', headers: r.H, body: JSON.stringify(ANSWERS) });
    expect(res.status).toBe(400);
    expect((await status(r.H)).required).toBe(true);
    expect((await paste(r)).status).toBe(403);
  });

  it('answers + the confirmation → stored on the request, and the rep can import', async () => {
    const r = await rep('hl4@example.com', 'hot_lead');
    const res = await fetch(`${base}/me/access-answers`, { method: 'POST', headers: r.H, body: JSON.stringify({ ...ANSWERS, confirmationAccepted: true }) });
    expect(res.status).toBe(200);
    expect(await status(r.H)).toEqual({ required: false, missing: [] });
    const stored = (await deps.accessRequests.list()).find((x) => x.workEmail === 'hl4@example.com')!;
    expect(stored).toMatchObject({ phone: '+971 50 386 3103', ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: 'under_50', industry: 'insurance', source: 'hot_lead' });
    expect(stored.confirmationAcceptedAt).toEqual(expect.any(Number));
    expect(stored.confirmationTextVersion).toEqual(expect.any(String));
    expect((await paste(r)).status).not.toBe(403);
  });

  it('NEGATIVE: a form sign-up who answered, and an account with no request, are never asked', async () => {
    for (const source of ['form', 'none'] as const) {
      const r = await rep(`hl5-${source}@example.com`, source);
      expect(await status(r.H)).toEqual({ required: false, missing: [] });
      expect((await paste(r)).status).not.toBe(403);
    }
  });
});
