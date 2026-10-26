import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';

/** [P45-3] Hot leads in the admin console: list + filters, status and notes (audited), Invite to beta, CSV, Signed up. */
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server!.listen(0, r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, deps };
}
const L = (n: number, o: Partial<HotLeadInput> = {}): HotLeadInput => ({ personId: `p${n}`, campaignId: 7, campaignName: 'Dubai brokers', name: `Lead ${n}`, email: `lead${n}@x.io`, jobTitle: 'Head of Sales', companyName: 'Acme', companyDomain: 'acme.io', linkedinUrl: 'https://linkedin.com/in/x', country: 'AE', phone: '+971501234567', whyHot: 'Yes please', becameHotAt: Date.now() - n * 3_600_000, erased: false, ...o });
const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });

describe('[P45-3] admin leads', () => {
  it('newest first, the New count, country filter, campaign name', async () => {
    const { base, deps } = await start();
    await deps.hotLeads.saveBatch([L(1), L(2, { country: 'GB' }), L(3)], Date.now());
    const { cookie } = await signInAdmin(base, deps);
    const all = (await (await fetch(`${base}/admin/leads`, { headers: { cookie } })).json()) as { leads: Array<{ name: string; campaignName: string }>; newCount: number; countries: string[] };
    expect(all.leads.map((l) => l.name)).toEqual(['Lead 1', 'Lead 2', 'Lead 3']);
    expect(all.newCount).toBe(3);
    expect(all.countries).toEqual(['AE', 'GB']);
    expect(all.leads[0]!.campaignName).toBe('Dubai brokers');
    const gb = (await (await fetch(`${base}/admin/leads?country=GB`, { headers: { cookie } })).json()) as { leads: Array<{ name: string }> };
    expect(gb.leads.map((l) => l.name)).toEqual(['Lead 2']);
  });

  it('a status change and notes are saved, and the status change is audited', async () => {
    const { base, deps } = await start();
    const [l] = await deps.hotLeads.saveBatch([L(1)], Date.now());
    const { cookie } = await signInAdmin(base, deps);
    const r = await fetch(`${base}/admin/leads/${l!.id}`, { method: 'PATCH', headers: json(cookie), body: JSON.stringify({ status: 'contacted', notes: 'Called, call back Sunday' }) });
    expect(((await r.json()) as { lead: { status: string; notes: string } }).lead).toMatchObject({ status: 'contacted', notes: 'Called, call back Sunday' });
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; detail: unknown; target: string }> };
    expect(entries.find((e) => e.action === 'lead.status')).toMatchObject({ target: 'lead1@x.io', detail: { from: 'new', to: 'contacted' } });
  });

  it('Invite to beta: a PENDING access request (not an invite), pre-filled from the lead; the lead is Invited; nothing is emailed', async () => {
    const { base, deps } = await start();
    const [l] = await deps.hotLeads.saveBatch([L(1)], Date.now());
    const { cookie } = await signInAdmin(base, deps);
    const before = deps.emailSender.sent.length;
    const r = await fetch(`${base}/admin/leads/${l!.id}/invite`, { method: 'POST', headers: json(cookie), body: '{}' });
    const body = (await r.json()) as { lead: { status: string }; request: { id: string; status: string; source: string; workEmail: string; fullName: string; companyName: string; roleTitle: string; industry: unknown } };
    expect(body.lead.status).toBe('invited');
    expect(body.request).toMatchObject({ status: 'pending', source: 'hot_lead', workEmail: 'lead1@x.io', fullName: 'Lead 1', companyName: 'Acme', roleTitle: 'Head of Sales', industry: null });
    expect(deps.emailSender.sent.length).toBe(before); // no invite email until the admin approves it on the Access tab
    const pending = (await (await fetch(`${base}/admin/access-requests?status=pending`, { headers: { cookie } })).json()) as { requests: Array<{ id: string }> };
    expect(pending.requests.map((x) => x.id)).toContain(body.request.id);
    expect((await fetch(`${base}/admin/leads/${l!.id}/invite`, { method: 'POST', headers: json(cookie), body: '{}' })).status).toBe(409);
  });

  it('Signed up is set automatically when an account is activated with the lead\'s email', async () => {
    const { base, deps } = await start();
    const [l] = await deps.hotLeads.saveBatch([L(1, { email: 'Lead1@X.io' })], Date.now());
    const { cookie } = await signInAdmin(base, deps);
    const { request } = (await (await fetch(`${base}/admin/leads/${l!.id}/invite`, { method: 'POST', headers: json(cookie), body: '{}' })).json()) as { request: { id: string } };
    await fetch(`${base}/admin/access-requests/${request.id}/approve`, { method: 'POST', headers: json(cookie), body: '{}' });
    const invite = /token=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.filter((m) => m.to === 'lead1@x.io').at(-1)!.text)![1]!;
    const accept = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: invite, password: 'password123', acceptTerms: true }) });
    expect(accept.status).toBeLessThan(300);
    expect((await deps.hotLeads.get(l!.id))!.status).toBe('signed_up');
  });

  it('CSV export of the current filter, audited', async () => {
    const { base, deps } = await start();
    await deps.hotLeads.saveBatch([L(1), L(2, { country: 'GB' })], Date.now());
    const { cookie } = await signInAdmin(base, deps);
    const r = await fetch(`${base}/admin/leads?country=GB&format=csv`, { headers: { cookie } });
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = (await r.text()).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Lead 2"');
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; detail: unknown }> };
    expect(entries[0]).toMatchObject({ action: 'leads.csv_export', detail: { country: 'GB', rows: 1 } });
  });

  it('NEGATIVE: leads are never on a rep route, and need the admin session', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/admin/leads`)).status).toBe(401);
  });
});
