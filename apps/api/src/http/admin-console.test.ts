import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { InMemoryCostReportStore } from '../adapters/spend/in-memory-cost-report-store.js';
import { CostReportService } from '../services/spend/cost-report-service.js';

/**
 * [P45-2 · owner] The console's Access and Costs, on the admin session (never the ops token): the same review
 * (list, approve, reject, re-invite) and the same cost report (period / month, CSV). Every action is audited.
 */
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  deps.adminCosts = new CostReportService(new InMemoryCostReportStore().seed({ calls: [{ userId: 'u1', periodKey: 'p:1', spendClass: 'extraction', costAed: 70, at: Date.parse('2026-10-02') }] }), async () => 'layla@x.io', async () => 45);
  server = createApiServer(deps);
  await new Promise<void>((r) => server!.listen(0, r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, deps };
}
const REQ = { fullName: 'Dana Rep', workEmail: 'dana@example.ae', phone: '+971 50 123 4567', companyName: 'Meridian', roleTitle: 'Advisor', ownership: 'employed', conversationOwnership: 'own_clients', expectedVolume: '50_200', industry: 'insurance', confirmationAccepted: true };
async function pending(base: string): Promise<string> {
  await fetch(`${base}/access-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQ) });
  return '';
}
const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });

describe('[P45-2] Access on the admin session', () => {
  it('lists pending requests (with industry), approves one, and audits it', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps);
    await pending(base);
    const { requests } = (await (await fetch(`${base}/admin/access-requests?status=pending`, { headers: { cookie } })).json()) as { requests: Array<{ id: string; workEmail: string; industry: string }> };
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ workEmail: 'dana@example.ae', industry: 'insurance' });
    const r = await fetch(`${base}/admin/access-requests/${requests[0]!.id}/approve`, { method: 'POST', headers: json(cookie), body: '{}' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { request: { status: string } }).request.status).toBe('invited');
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; target: string; adminEmail: string }> };
    expect(entries[0]).toMatchObject({ action: 'access.approve', target: 'dana@example.ae', adminEmail: 'wabil@tovira.io' });
  });

  it('reject (with a note) and re-invite are audited too', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps);
    await pending(base); await pending(base);
    const ids = ((await (await fetch(`${base}/admin/access-requests`, { headers: { cookie } })).json()) as { requests: Array<{ id: string }> }).requests.map((x) => x.id);
    await fetch(`${base}/admin/access-requests/${ids[0]}/reject`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ note: 'not a fit' }) });
    await fetch(`${base}/admin/access-requests/${ids[1]}/approve`, { method: 'POST', headers: json(cookie), body: '{}' });
    expect((await fetch(`${base}/admin/access-requests/${ids[1]}/reinvite`, { method: 'POST', headers: json(cookie), body: '{}' })).status).toBe(200);
    const actions = ((await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; detail: unknown }> }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['access.reject', 'access.approve', 'access.reinvite']));
  });

  it('NEGATIVE: without an admin session (none, or a rep\'s) the console\'s data is refused', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/admin/access-requests`)).status).toBe(401);
    const rep = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string };
    expect((await fetch(`${base}/admin/access-requests`, { headers: { authorization: `Bearer ${rep.token}`, cookie: `session=${rep.token}` } })).status).toBe(401);
    expect((await fetch(`${base}/admin/costs`, { headers: { cookie: `session=${rep.token}` } })).status).toBe(401);
  });
});

describe('[P45-2] Costs on the admin session', () => {
  it('the report (period by default, month on request), and the CSV export is audited', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps);
    const period = (await (await fetch(`${base}/admin/costs`, { headers: { cookie } })).json()) as { view: string; rows: Array<{ email: string; overCeiling: boolean }> };
    expect(period.view).toBe('period');
    expect(period.rows[0]).toMatchObject({ email: 'layla@x.io', overCeiling: true });
    expect(((await (await fetch(`${base}/admin/costs?view=month`, { headers: { cookie } })).json()) as { view: string }).view).toBe('month');
    const csv = await fetch(`${base}/admin/costs?view=month&format=csv`, { headers: { cookie } });
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    const actions = ((await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; detail: { view: string } | null }> }).entries;
    expect(actions[0]).toMatchObject({ action: 'costs.csv_export', detail: { view: 'month' } });
  });
});
