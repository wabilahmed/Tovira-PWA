import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_ADMIN_EMAIL, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { listenForTest } from '../test-support/listen.js';

// [P60 · owner] What reaches ADMIN_EMAILS when someone joins and starts. One short email per event, in the standard
// Tovira template (with a plain-text version):
//  (1) a public-form request: the existing "Beta access request" email, unchanged
//  (2) an invited lead who submits and is approved at once: "Sara Khan (Emaar) joined via your invite" (it replaces the
//      request email, which read as if it still needed approving)
//  (3) the first sign-in after setting a password: "Sara Khan signed in for the first time", once per person
//  (4) the first chat import or voice note: "Sara Khan imported their first chat" / "… recorded their first voice note",
//      once per person (whichever comes first; a typed note doesn't count)
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const LEAD: HotLeadInput = { personId: 'p1', campaignId: 7, campaignName: 'c', name: 'Sara Khan', email: 'sara@emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: null, linkedinUrl: null, country: 'AE', phone: null, whyHot: 'yes', becameHotAt: Date.now(), erased: false };
const FORM = { fullName: 'Sara Khan', workEmail: 'sara@emaar.example', phone: '+971 50 123 4567', companyName: 'Emaar', roleTitle: 'Head of Leasing', ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-1', conversationOwnership: 'own_clients', expectedVolume: '50_200', industry: 'property', confirmationAccepted: true };
const JSONH = { 'content-type': 'application/json' };
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 5, 6, 7, 8]);

async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  return { base: await listenForTest(server!), deps };
}
const toAdmin = (deps: TestDeps) => deps.emailSender.sent.filter((m) => m.to === TEST_ADMIN_EMAIL);
const subjects = (deps: TestDeps) => toAdmin(deps).map((m) => m.subject);

/** Invite → submit (approved at once) → accept the set-password link → sign in. */
async function journey(base: string, deps: TestDeps): Promise<{ token: string }> {
  const [lead] = await deps.hotLeads.saveBatch([LEAD], Date.now());
  const { cookie } = await signInAdmin(base, deps);
  await fetch(`${base}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: '{}' });
  const invite = /request-access\?invite=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.filter((m) => m.to === 'sara@emaar.example').at(-1)!.text)![1]!;
  await fetch(`${base}/access-request`, { method: 'POST', headers: JSONH, body: JSON.stringify({ ...FORM, inviteToken: invite }) });
  const setPw = /token=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.filter((m) => m.subject === 'Your Tovira invitation').at(-1)!.text)![1]!;
  await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: JSONH, body: JSON.stringify({ token: setPw, password: 'password123', acceptTerms: true }) });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'sara@emaar.example', password: 'password123' }) });
  return { token: ((await login.json()) as { token: string }).token };
}

describe('[P60] emails to ADMIN_EMAILS', () => {
  it('(1) a public-form request: the request email, as before, and no "joined" email', async () => {
    const { base, deps } = await start();
    await fetch(`${base}/access-request`, { method: 'POST', headers: JSONH, body: JSON.stringify({ ...FORM, workEmail: 'dana@brokerage.example', fullName: 'Dana Rep' }) });
    expect(subjects(deps)).toEqual(['Beta access request — Dana Rep (Emaar)']);
  });

  it('(2) an invited lead who submits: "Sara Khan (Emaar) joined via your invite", in the standard template, instead of the request email', async () => {
    const { base, deps } = await start();
    await journey(base, deps);
    const joined = toAdmin(deps).find((m) => m.subject === 'Sara Khan (Emaar) joined via your invite')!;
    expect(joined).toBeTruthy();
    expect(joined.text).toContain('sara@emaar.example');
    expect(joined.text).toContain('approved automatically');
    expect(joined.html).toContain('<span style="color:#d14821;">T</span>o<span style="color:#d14821;">v</span>ira'); // the standard template
    expect(subjects(deps).some((s) => s.startsWith('Beta access request'))).toBe(false);
  });

  it('(3) the first sign-in: "Sara Khan signed in for the first time", once', async () => {
    const { base, deps } = await start();
    await journey(base, deps);
    expect(subjects(deps).filter((s) => s === 'Sara Khan signed in for the first time')).toHaveLength(1);
    await fetch(`${base}/auth/login`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'sara@emaar.example', password: 'password123' }) });
    expect(subjects(deps).filter((s) => s.includes('signed in'))).toHaveLength(1);
  });

  it('(4) the first voice note: "Sara Khan recorded their first voice note", once; a later chat import sends nothing', async () => {
    const { base, deps } = await start();
    const { token } = await journey(base, deps);
    const H = { authorization: `Bearer ${token}` };
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: { ...H, ...JSONH }, body: JSON.stringify({ name: 'Omar Haddad' }) })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: { ...H, ...JSONH }, body: JSON.stringify({ text: 'Typed notes do not count.' }) });
    expect(subjects(deps).some((s) => s.includes('their first'))).toBe(false); // a typed note doesn't count
    await fetch(`${base}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { ...H, 'content-type': 'audio/webm' }, body: WEBM });
    await fetch(`${base}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { ...H, 'content-type': 'audio/webm' }, body: WEBM });
    const chat = '13/07/2026, 9:00 am - Wabil: hi\n13/07/2026, 9:01 am - Omar Haddad: hello';
    await fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: { ...H, ...JSONH }, body: JSON.stringify({ firstImportAck: true, consent: true, content: chat }) });
    expect(subjects(deps).filter((s) => s.includes('their first'))).toEqual(['Sara Khan recorded their first voice note']);
  });

  it('(4) the first chat import: "Sara Khan imported their first chat"', async () => {
    const { base, deps } = await start();
    const { token } = await journey(base, deps);
    const H = { authorization: `Bearer ${token}`, ...JSONH };
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Omar Haddad' }) })).json()) as { id: string }).id;
    const chat = '13/07/2026, 9:00 am - Wabil: hi\n13/07/2026, 9:01 am - Omar Haddad: hello';
    const r = await fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: H, body: JSON.stringify({ firstImportAck: true, consent: true, content: chat }) });
    expect(r.status).toBeLessThan(300);
    const first = toAdmin(deps).find((m) => m.subject === 'Sara Khan imported their first chat')!;
    expect(first).toBeTruthy();
    expect(first.html).toContain('Tovira · tovira.io'); // the standard footer ([P61-5 · owner] was the old tagline)
  });

  it('NEGATIVE: a typed note alone never sends the first-capture email', async () => {
    const { base, deps } = await start();
    const { token } = await journey(base, deps);
    const H = { authorization: `Bearer ${token}`, ...JSONH };
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Omar Haddad' }) })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Typed notes do not count.' }) });
    expect(subjects(deps).some((s) => s.includes('their first'))).toBe(false);
  });

  it('existing users are marked as already notified (the migration), so nobody already using Tovira gets a "first" email', () => {
    const sql = readFileSync(new URL('../../migrations/0109_admin_event_backfill.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/'admin\.first_capture'[\s\S]*FROM notes[\s\S]*source IN \('voice', 'whatsapp_export'\)/);
    expect(sql).toMatch(/'admin\.first_sign_in'[\s\S]*FROM users/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });
});
