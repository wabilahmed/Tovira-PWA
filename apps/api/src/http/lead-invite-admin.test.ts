import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { listenForTest } from '../test-support/listen.js';

// [P58-4 · owner] Admin → Leads → "Send invite email": a preview with an editable personal line, nothing sent until
// Send; one invite per lead; Resend after 3 days, once; never to Not interested, an existing account or an erased
// contact; every send and resend audited. Plus a test lead (marked, never counted or exported) for the owner's own try.
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  return { base: await listenForTest(server!), deps };
}
const L = (o: Partial<HotLeadInput> = {}): HotLeadInput => ({ personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Sara Khan', email: 'sara@emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: null, linkedinUrl: null, country: 'AE', phone: null, whyHot: 'Sounds good, tell me more', becameHotAt: Date.now() - 3_600_000, erased: false, ...o });
const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });
const DAY = 86_400_000;
const sentTo = (deps: TestDeps, to: string) => deps.emailSender.sent.filter((m) => m.to === to);

async function setup(o: Partial<HotLeadInput> = {}) {
  const { base, deps } = await start();
  const [lead] = await deps.hotLeads.saveBatch([L(o)], Date.now());
  const { cookie } = await signInAdmin(base, deps);
  const send = (body: unknown = {}) => fetch(`${base}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: json(cookie), body: JSON.stringify(body) });
  const audit = async () => ((await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; target: string; detail: Record<string, unknown> | null }> }).entries;
  return { base, deps, lead: lead!, cookie, send, audit };
}

describe('[P58-4] the preview', () => {
  it('shows the email with the personal line; nothing is sent or recorded', async () => {
    const { base, deps, lead, cookie } = await setup();
    const before = deps.emailSender.sent.length;
    const r = await fetch(`${base}/admin/leads/${lead.id}/invite-email/preview`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ personalLine: 'Great talking at GITEX.' }) });
    expect(r.status).toBe(200);
    const p = (await r.json()) as { to: string; from: string; replyTo: string; subject: string; html: string; text: string };
    expect(p).toMatchObject({ to: 'sara@emaar.example', from: '"Wabil Ahmed, Tovira" <wabil@tovira.io>', replyTo: 'wabil@tovira.io', subject: 'Your Tovira beta invite' });
    expect(p.text).toContain('Hi Sara,\n\nGreat talking at GITEX.');
    expect(p.html).toContain('Great talking at GITEX.');
    expect(deps.emailSender.sent.length).toBe(before);
    expect((await deps.hotLeads.get(lead.id))!.inviteSentAt).toBeNull();
  });
});

describe('[P58-4] Send', () => {
  it('sends from the founder with a link that carries a token and no personal data; the lead is Invited; audited', async () => {
    const { deps, lead, send, audit } = await setup();
    const r = await send({ personalLine: 'Thanks for the quick reply.' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { lead: { status: string; inviteSentAt: number } }).lead).toMatchObject({ status: 'invited', inviteSentAt: expect.any(Number) });
    const [m] = sentTo(deps, 'sara@emaar.example');
    expect(m).toMatchObject({ from: '"Wabil Ahmed, Tovira" <wabil@tovira.io>', replyTo: 'wabil@tovira.io', subject: 'Your Tovira beta invite' });
    const link = /https:\/\/tovira\.io\/request-access\?invite=([A-Za-z0-9_-]+)\n/.exec(m!.text)!;
    expect(link[1]!.length).toBeGreaterThanOrEqual(43);
    expect(link[0]).not.toMatch(/sara|emaar|khan|%40|@/i); // no personal data in the URL
    expect(m!.html).toContain(link[0].trim());
    expect((await audit()).find((e) => e.action === 'lead.invite_email')).toMatchObject({ target: 'sara@emaar.example', detail: { leadId: lead.id } });
  });
  it('NEGATIVE: a second send is refused and nothing is sent', async () => {
    const { deps, send } = await setup();
    await send();
    const r = await send();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'already_sent' });
    expect(sentTo(deps, 'sara@emaar.example')).toHaveLength(1);
  });
  it('NEGATIVE: Resend is refused before 3 days; after 3 days it sends a new link, once; audited', async () => {
    const { deps, send, audit } = await setup();
    await send();
    const early = await send({ resend: true });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: 'too_soon' });
    deps.leadInviteClock.offsetMs = 3 * DAY;
    const again = await send({ resend: true });
    expect(again.status).toBe(200);
    const [first, second] = sentTo(deps, 'sara@emaar.example');
    expect(second!.text).not.toBe(first!.text); // a new token
    expect((await audit()).some((e) => e.action === 'lead.invite_email_resend')).toBe(true);
    deps.leadInviteClock.offsetMs = 9 * DAY;
    const third = await send({ resend: true });
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: 'already_resent' });
    expect(sentTo(deps, 'sara@emaar.example')).toHaveLength(2);
  });
  it('NEGATIVE: never to a lead marked Not interested', async () => {
    const { base, deps, lead, cookie, send } = await setup();
    await fetch(`${base}/admin/leads/${lead.id}`, { method: 'PATCH', headers: json(cookie), body: JSON.stringify({ status: 'not_interested' }) });
    const r = await send();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'not_interested' });
    expect(sentTo(deps, 'sara@emaar.example')).toHaveLength(0);
  });
  it('NEGATIVE: never to someone who already has an account', async () => {
    const { base, deps, send } = await setup();
    await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Sara@Emaar.example', password: 'password123' }) });
    const before = sentTo(deps, 'sara@emaar.example').length;
    const r = await send();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'has_account' });
    expect(sentTo(deps, 'sara@emaar.example')).toHaveLength(before);
  });
  it('NEGATIVE: never to an erased contact (P46: only a tombstone is left, so there is nothing to email)', async () => {
    const { deps, lead, send } = await setup();
    await deps.hotLeads.saveBatch([L({ erased: true })], Date.now());
    const r = await send();
    expect(r.status).toBe(404);
    expect(await deps.hotLeads.get(lead.id)).toBeNull();
    expect(sentTo(deps, 'sara@emaar.example')).toHaveLength(0);
  });
  it('NEGATIVE: an email that fails to go is undone, so Send can be tried again', async () => {
    const { deps, lead, send } = await setup();
    const spy = vi.spyOn(deps.emailSender, 'send').mockRejectedValueOnce(new Error('resend 500'));
    const r = await send();
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: 'send_failed' });
    expect((await deps.hotLeads.get(lead.id))!).toMatchObject({ status: 'new', inviteSentAt: null });
    spy.mockRestore();
    expect((await send()).status).toBe(200);
  });
  it('NEGATIVE: without an admin session, nothing (401)', async () => {
    const { base, lead } = await setup();
    expect((await fetch(`${base}/admin/leads/${lead.id}/invite-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });
});

describe('[P58-4] a test lead', () => {
  it('the owner adds one; it is marked, can be emailed, and is never counted or exported; audited', async () => {
    const { base, deps, cookie, audit } = await setup();
    const r = await fetch(`${base}/admin/leads/test`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'Wabil Ahmed', email: 'wabil@prospera-technologies.com', companyName: 'Prospera', jobTitle: 'Founder' }) });
    expect(r.status).toBe(201);
    const { lead } = (await r.json()) as { lead: { id: string; isTest: boolean } };
    expect(lead.isTest).toBe(true);
    const list = (await (await fetch(`${base}/admin/leads`, { headers: { cookie } })).json()) as { leads: Array<{ id: string }>; newCount: number };
    expect(list.leads.map((l) => l.id)).toContain(lead.id);
    expect(list.newCount).toBe(1); // only the real lead
    expect(await (await fetch(`${base}/admin/leads?format=csv`, { headers: { cookie } })).text()).not.toContain('prospera');
    expect((await fetch(`${base}/admin/leads/${lead.id}/invite-email`, { method: 'POST', headers: json(cookie), body: '{}' })).status).toBe(200);
    expect(sentTo(deps, 'wabil@prospera-technologies.com')).toHaveLength(1);
    expect((await audit()).find((e) => e.action === 'lead.test_created')).toMatchObject({ target: 'wabil@prospera-technologies.com' });
  });
  it('NEGATIVE: a test lead needs a name and a valid email', async () => {
    const { base, cookie } = await setup();
    expect((await fetch(`${base}/admin/leads/test`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: '', email: 'x@y.io' }) })).status).toBe(400);
    expect((await fetch(`${base}/admin/leads/test`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'W', email: 'not-an-email' }) })).status).toBe(400);
  });
});
