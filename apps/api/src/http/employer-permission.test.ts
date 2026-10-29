import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { listenForTest } from '../test-support/listen.js';
import { EMPLOYER_PERMISSION_TEXT } from '../services/access/access-request-service.js';
import { StubEmailSender } from '../adapters/email/stub-email-sender.js';
import { AccountEmailService } from '../services/email/account-email-service.js';
import { InMemoryEmailLogRepository } from '../adapters/email/in-memory-email-log-repository.js';

// [P59-1 · owner] Invitees stay approved at once, with no NOC wait. An invitee who says they are employed must also tick
// "I have my employer's permission to use Tovira with their clients' information." The exact wording and when it was
// ticked are stored with the request. Without the tick the request is refused (nothing created, the link still works).
// Owners, and public requests (which wait for the admin as before), are not asked and store nothing.
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const LEAD: HotLeadInput = { personId: 'p1', campaignId: 7, campaignName: 'c', name: 'Sara Khan', email: 'sara@emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: null, linkedinUrl: null, country: 'AE', phone: null, whyHot: 'yes', becameHotAt: Date.now(), erased: false };
const FORM = { fullName: 'Sara Khan', workEmail: 'sara@emaar.example', phone: '+971 50 123 4567', companyName: 'Emaar', roleTitle: 'Head of Leasing', conversationOwnership: 'brokerage_employs_me', expectedVolume: '50_200', industry: 'property', confirmationAccepted: true };
const JSONH = { 'content-type': 'application/json' };

async function invited(): Promise<{ base: string; deps: TestDeps; token: string; cookie: string }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  const base = await listenForTest(server!);
  const [lead] = await deps.hotLeads.saveBatch([LEAD], Date.now());
  const { cookie } = await signInAdmin(base, deps);
  await fetch(`${base}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: '{}' });
  const token = /request-access\?invite=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.at(-1)!.text)![1]!;
  return { base, deps, token, cookie };
}
const submit = (base: string, body: unknown) => fetch(`${base}/access-request`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const request = async (base: string, cookie: string, status: string) => ((await (await fetch(`${base}/admin/access-requests?status=${status}`, { headers: { cookie } })).json()) as { requests: Array<Record<string, unknown>> }).requests;

describe('[P59-1] the employer\'s permission, for employed invitees', () => {
  it('the wording, word for word', () => {
    expect(EMPLOYER_PERMISSION_TEXT).toBe('I have my employer\'s permission to use Tovira with their clients\' information.');
  });
  it('employed and ticked: approved at once (no NOC wait); the wording and the time are stored with the request', async () => {
    const { base, deps, token, cookie } = await invited();
    const before = Date.now();
    const r = await submit(base, { ...FORM, ownership: 'employed', employerPermissionAccepted: true, inviteToken: token });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ approved: true });
    const [req] = await request(base, cookie, 'invited');
    expect(req).toMatchObject({ ownership: 'employed', employerPermissionText: EMPLOYER_PERMISSION_TEXT });
    expect(req!.employerPermissionAcceptedAt).toBeGreaterThanOrEqual(before);
    expect(deps.emailSender.sent.filter((m) => m.subject === 'Your Tovira invitation')).toHaveLength(1);
  });
  it('NEGATIVE: employed without the tick is refused; nothing is created or sent, and the link still works', async () => {
    const { base, deps, token, cookie } = await invited();
    const r = await submit(base, { ...FORM, ownership: 'employed', inviteToken: token });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'validation', field: 'employerPermissionAccepted', message: 'Please tick that you have your employer\'s permission.' });
    expect(await request(base, cookie, 'pending')).toEqual([]);
    expect(await request(base, cookie, 'invited')).toEqual([]);
    expect(deps.emailSender.sent.some((m) => m.subject === 'Your Tovira invitation')).toBe(false);
    expect((await fetch(`${base}/access-request/invite`, { method: 'POST', headers: JSONH, body: JSON.stringify({ token }) })).status).toBe(200);
  });
  it('NEGATIVE: an owner is not asked; a tick sent anyway stores nothing', async () => {
    const { base, token, cookie } = await invited();
    const r = await submit(base, { ...FORM, conversationOwnership: 'own_clients', ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-1', employerPermissionAccepted: true, inviteToken: token });
    expect(await r.json()).toMatchObject({ approved: true });
    const [req] = await request(base, cookie, 'invited');
    expect(req).toMatchObject({ employerPermissionText: null, employerPermissionAcceptedAt: null });
  });
  it('NEGATIVE: a public request is not asked, stores nothing, and still waits for the admin', async () => {
    const { base, cookie } = await invited();
    const r = await submit(base, { ...FORM, workEmail: 'dana@brokerage.example', ownership: 'employed', employerPermissionAccepted: true });
    expect(await r.json()).toMatchObject({ approved: false });
    const [req] = await request(base, cookie, 'pending');
    expect(req).toMatchObject({ employerPermissionText: null, employerPermissionAcceptedAt: null });
  });
  it('the admin\'s notification says the permission was confirmed, never "ask for the company NOC before approving"', async () => {
    const { base, deps, token, cookie } = await invited();
    await submit(base, { ...FORM, ownership: 'employed', employerPermissionAccepted: true, inviteToken: token });
    const [rec] = await request(base, cookie, 'invited');
    const sender = new StubEmailSender();
    await new AccountEmailService(sender, new InMemoryEmailLogRepository(), 'https://tovira.io').sendAccessRequestNotification('admin@tovira.io', rec as never, 'https://tovira.io/x');
    expect(sender.sent[0]!.text).toContain(`Employed: confirmed "${EMPLOYER_PERMISSION_TEXT}" and approved automatically (your invite).`);
    expect(sender.sent[0]!.text).not.toContain('ask for the company NOC');
    void deps;
  });
});
