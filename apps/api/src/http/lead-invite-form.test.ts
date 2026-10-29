import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { listenForTest } from '../test-support/listen.js';

// [P58-5 · owner] The link in the invite email opens the request form. With its token the form loads the lead's name,
// email, company and job title from the server (nothing personal rides in the URL); an expired, used or unknown token
// is simply the normal empty form. The email is locked to the invited address (the server takes it from the lead, never
// from the form). A request from the invite link is approved at once (the founder chose this lead by sending it) and the
// normal set-password email goes; a request from the public form still waits. The lead moves Invited → Requested →
// Signed up.
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const DAY = 86_400_000;
const LEAD: HotLeadInput = { personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Sara Khan', email: 'Sara@Emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: 'emaar.example', linkedinUrl: 'https://linkedin.com/in/sk', country: 'AE', phone: '+971501112222', whyHot: 'Yes, tell me more', becameHotAt: Date.now() - 3_600_000, erased: false };
const ANSWERS = { phone: '+971 50 123 4567', ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: '50_200', industry: 'property', confirmationAccepted: true };
const JSONH = { 'content-type': 'application/json' };

async function invited(): Promise<{ base: string; deps: TestDeps; leadId: string; token: string; cookie: string }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  const base = await listenForTest(server!);
  const [lead] = await deps.hotLeads.saveBatch([LEAD], Date.now());
  const { cookie } = await signInAdmin(base, deps);
  await fetch(`${base}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: '{}' });
  const token = /request-access\?invite=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.filter((m) => m.to === 'Sara@Emaar.example').at(-1)!.text)![1]!;
  return { base, deps, leadId: lead!.id, token, cookie };
}
const prefill = (base: string, token: string) => fetch(`${base}/access-request/invite`, { method: 'POST', headers: JSONH, body: JSON.stringify({ token }) });
const submit = (base: string, body: unknown) => fetch(`${base}/access-request`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const setPasswordEmails = (deps: TestDeps) => deps.emailSender.sent.filter((m) => m.subject === 'Your Tovira invitation');

describe('[P58-5] the prefilled form', () => {
  it('the token loads exactly the name, email, company and job title (nothing else)', async () => {
    const { base, token } = await invited();
    const r = await prefill(base, token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fullName: 'Sara Khan', workEmail: 'sara@emaar.example', companyName: 'Emaar', roleTitle: 'Head of Leasing' });
  });
  it('NEGATIVE: an unknown, expired or replaced token is the normal empty form (404, nothing about anyone)', async () => {
    const { base, deps, token, leadId, cookie } = await invited();
    const unknown = await prefill(base, 'x'.repeat(43));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'invalid' });
    deps.leadInviteClock.offsetMs = 14 * DAY;
    expect((await prefill(base, token)).status).toBe(404); // expired
    deps.leadInviteClock.offsetMs = 3 * DAY;
    await fetch(`${base}/admin/leads/${leadId}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: JSON.stringify({ resend: true }) });
    expect((await prefill(base, token)).status).toBe(404); // the resend replaced it
  });
  it('NEGATIVE: a lead marked Not interested after the send gets the empty form', async () => {
    const { base, deps, token, leadId } = await invited();
    await deps.hotLeads.update(leadId, { status: 'not_interested' }, Date.now());
    expect((await prefill(base, token)).status).toBe(404);
  });
});

describe('[P58-5] submitting from the invite', () => {
  it('the email is locked to the invited address; the request is approved at once and the set-password email goes; the lead is Requested; audited', async () => {
    const { base, deps, token, leadId, cookie } = await invited();
    const r = await submit(base, { fullName: 'Sara Khan', workEmail: 'someone-else@other.example', companyName: 'Emaar', roleTitle: 'Head of Leasing', ...ANSWERS, inviteToken: token });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, approved: true });
    expect(setPasswordEmails(deps).map((m) => m.to)).toEqual(['sara@emaar.example']); // never the other address
    expect(deps.emailSender.sent.some((m) => m.to === 'someone-else@other.example')).toBe(false);
    const lead = (await deps.hotLeads.get(leadId))!;
    expect(lead).toMatchObject({ status: 'requested', requestedAt: expect.any(Number) });
    const req = (await (await fetch(`${base}/admin/access-requests?status=invited`, { headers: { cookie } })).json()) as { requests: Array<{ id: string; workEmail: string }> };
    expect(req.requests).toEqual([expect.objectContaining({ id: lead.accessRequestId, workEmail: 'sara@emaar.example' })]);
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; target: string; adminEmail?: string }> };
    expect(entries.find((e) => e.action === 'lead.requested')).toMatchObject({ target: 'sara@emaar.example' });
    expect(entries.find((e) => e.action === 'access.auto_approve')).toMatchObject({ target: 'sara@emaar.example' });
  });
  it('NEGATIVE: the token works once; a second submit with it waits for the admin like any public request', async () => {
    const { base, deps, token } = await invited();
    await submit(base, { fullName: 'Sara Khan', workEmail: 'sara@emaar.example', companyName: 'Emaar', roleTitle: 'Head of Leasing', ...ANSWERS, inviteToken: token });
    const again = await submit(base, { fullName: 'Sara Khan', workEmail: 'sara2@emaar.example', companyName: 'Emaar', roleTitle: 'Head of Leasing', ...ANSWERS, inviteToken: token });
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ approved: false });
    expect(setPasswordEmails(deps)).toHaveLength(1);
    expect((await prefill(base, token)).status).toBe(404);
  });
  it('NEGATIVE: a public request (no invite) still waits for the admin: nothing is approved or emailed to the requester', async () => {
    const { base, deps } = await invited();
    const r = await submit(base, { fullName: 'Dana Rep', workEmail: 'dana@brokerage.example', companyName: 'Meridian', roleTitle: 'Broker', ...ANSWERS });
    expect(await r.json()).toMatchObject({ ok: true, approved: false });
    expect(deps.emailSender.sent.some((m) => m.to === 'dana@brokerage.example')).toBe(false);
  });
  it('the whole way: Invited → Requested → Signed up', async () => {
    const { base, deps, token, leadId } = await invited();
    expect((await deps.hotLeads.get(leadId))!.status).toBe('invited');
    await submit(base, { fullName: 'Sara Khan', workEmail: 'sara@emaar.example', companyName: 'Emaar', roleTitle: 'Head of Leasing', ...ANSWERS, inviteToken: token });
    expect((await deps.hotLeads.get(leadId))!.status).toBe('requested');
    const setPw = /token=([A-Za-z0-9_-]+)/.exec(setPasswordEmails(deps)[0]!.text)![1]!;
    const accept = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: JSONH, body: JSON.stringify({ token: setPw, password: 'password123', acceptTerms: true }) });
    expect(accept.status).toBeLessThan(300);
    expect((await deps.hotLeads.get(leadId))!.status).toBe('signed_up');
  });
});
