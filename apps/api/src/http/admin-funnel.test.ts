import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';
import { InMemoryFunnelSource } from '../adapters/funnel/in-memory-funnel-source.js';
import { funnelReport, type FunnelPerson } from '../services/funnel/funnel.js';
import { toFunnelPerson, FUNNEL_LEADS_SQL, FUNNEL_REQUESTS_SQL } from '../adapters/funnel/pg-funnel-source.js';

// [P63-6 · owner] Admin → Funnel: for 7 days / 30 days / all, the count at each step (invites sent, links opened, forms
// submitted invite vs public, approved, password set, first sign-in, first client), and below one row per lead with each
// step's date. The counts are counted from the rows, so they always match. Test leads never count. Admin session only.
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-05T12:00:00Z');
const base: FunnelPerson = { key: '', name: null, email: null, company: null, source: 'invite', isTest: false, inviteSentAt: null, inviteOpenedAt: null, submittedAt: null, approvedAt: null, passwordSetAt: null, firstSignInAt: null, firstClientAt: null };
const P = (o: Partial<FunnelPerson>): FunnelPerson => ({ ...base, ...o });
const PEOPLE: FunnelPerson[] = [
  // invited 2 days ago, went all the way
  P({ key: 'lead:1', name: 'Sara Khan', email: 'sara@emaar.example', inviteSentAt: NOW - 2 * DAY, inviteOpenedAt: NOW - 2 * DAY + 3600e3, submittedAt: NOW - 2 * DAY + 4000e3, approvedAt: NOW - 2 * DAY + 4000e3, passwordSetAt: NOW - DAY, firstSignInAt: NOW - DAY, firstClientAt: NOW - DAY + 600e3 }),
  // invited 3 days ago, opened, stopped
  P({ key: 'lead:2', name: 'Omar Haddad', email: 'omar@aldar.example', inviteSentAt: NOW - 3 * DAY, inviteOpenedAt: NOW - 3 * DAY + 60e3 }),
  // invited 20 days ago, never opened
  P({ key: 'lead:3', name: 'Priya Nair', email: 'priya@x.example', inviteSentAt: NOW - 20 * DAY }),
  // the public form, 1 day ago, approved, password not set
  P({ key: 'request:9', name: 'Dana Rep', email: 'dana@example.ae', source: 'public', submittedAt: NOW - DAY, approvedAt: NOW - DAY + 60e3 }),
  // the public form 60 days ago
  P({ key: 'request:8', name: 'Old Lead', email: 'old@example.ae', source: 'public', submittedAt: NOW - 60 * DAY }),
  // the owner's test lead: never counted, never a row
  P({ key: 'lead:4', name: 'Wabil test', email: 'hello@tovira.io', isTest: true, inviteSentAt: NOW - DAY, inviteOpenedAt: NOW - DAY }),
];

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ url: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  deps.adminFunnel = { source: new InMemoryFunnelSource().seed(PEOPLE), now: () => NOW };
  server = createApiServer(deps);
  return { url: await listenForTest(server!), deps };
}

describe('[P63-6] the funnel report', () => {
  it('7 days: the count at each step', () => {
    const r = funnelReport(PEOPLE, '7d', NOW);
    expect(r.counts).toEqual({ invitesSent: 2, linksOpened: 2, formsSubmitted: { invite: 1, public: 1, total: 2 }, approved: 2, passwordSet: 1, firstSignIn: 1, firstClient: 1 });
    expect(r.rows.map((p) => p.key)).toEqual(['request:9', 'lead:1', 'lead:2']); // newest first
  });
  it('30 days and all widen the window', () => {
    expect(funnelReport(PEOPLE, '30d', NOW).counts.invitesSent).toBe(3);
    expect(funnelReport(PEOPLE, 'all', NOW).rows).toHaveLength(5);
    expect(funnelReport(PEOPLE, 'all', NOW).counts.formsSubmitted).toEqual({ invite: 1, public: 2, total: 3 });
  });
  it('the counts match the per-lead rows, for every period', () => {
    for (const period of ['7d', '30d', 'all'] as const) {
      const r = funnelReport(PEOPLE, period, NOW);
      const has = (f: keyof FunnelPerson) => r.rows.filter((p) => p[f] != null).length;
      expect(r.counts.invitesSent).toBe(has('inviteSentAt'));
      expect(r.counts.linksOpened).toBe(has('inviteOpenedAt'));
      expect(r.counts.formsSubmitted.total).toBe(has('submittedAt'));
      expect(r.counts.approved).toBe(has('approvedAt'));
      expect(r.counts.passwordSet).toBe(has('passwordSetAt'));
      expect(r.counts.firstSignIn).toBe(has('firstSignInAt'));
      expect(r.counts.firstClient).toBe(has('firstClientAt'));
    }
  });
  it('NEGATIVE: a test lead is never counted and never a row', () => {
    const r = funnelReport(PEOPLE, 'all', NOW);
    expect(r.rows.some((p) => p.isTest)).toBe(false);
    expect(r.rows.some((p) => p.email === 'hello@tovira.io')).toBe(false);
  });
  it('the pg rows map to the same shape (timestamps to ms, nulls kept)', () => {
    expect(toFunnelPerson({ key: 'lead:1', name: 'S', email: 'e', company: null, source: 'invite', is_test: false, invite_sent_at: new Date(NOW), invite_opened_at: null, submitted_at: null, approved_at: null, password_set_at: null, first_sign_in_at: null, first_client_at: null }))
      .toEqual(P({ key: 'lead:1', name: 'S', email: 'e', inviteSentAt: NOW }));
    expect(FUNNEL_LEADS_SQL).toMatch(/h\.invite_opened_at/);
    expect(FUNNEL_REQUESTS_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM hot_leads h WHERE h\.access_request_id = a\.id/); // an invited lead is one row, never two
  });
});

describe('[P63-6] GET /admin/funnel', () => {
  it('the admin gets the counts and rows for the chosen period', async () => {
    const { url, deps } = await start();
    const { cookie } = await signInAdmin(url, deps);
    const r = await fetch(`${url}/admin/funnel?period=7d`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { counts: { invitesSent: number }; rows: FunnelPerson[]; period: string };
    expect(body.period).toBe('7d');
    expect(body.counts.invitesSent).toBe(2);
    expect(body.rows).toHaveLength(3);
  });
  it('NEGATIVE: an unknown period is refused', async () => {
    const { url, deps } = await start();
    const { cookie } = await signInAdmin(url, deps);
    expect((await fetch(`${url}/admin/funnel?period=year`, { headers: { cookie } })).status).toBe(400);
  });
  it('NEGATIVE: without an admin session (none, or a rep\'s) it is refused and shows no lead', async () => {
    const { url } = await start();
    const none = await fetch(`${url}/admin/funnel`);
    expect(none.status).toBe(401);
    expect(await none.text()).not.toContain('Sara');
    const s = (await (await fetch(`${url}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string };
    const rep = await fetch(`${url}/admin/funnel`, { headers: { authorization: `Bearer ${s.token}` } });
    expect(rep.status).toBe(401);
    expect(await rep.text()).not.toContain('Sara');
  });
});

// [P63-8 · owner] Admin → Funnel also shows the site visits for the period: visits per day, unique visitors, top
// referrers, and the share of landing-page visitors who reach request access, and who submit.
describe('[P63-8] visits in the funnel', () => {
  it('the funnel answer carries the visit report for the same period', async () => {
    const { url, deps } = await start();
    const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1';
    await fetch(`${url}/visit`, { method: 'POST', headers: { 'user-agent': PHONE, 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify({ page: 'landing', referrer: 'https://linkedin.com/feed' }) });
    await fetch(`${url}/visit`, { method: 'POST', headers: { 'user-agent': PHONE, 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify({ page: 'request_access' }) });
    const { cookie } = await signInAdmin(url, deps);
    const body = (await (await fetch(`${url}/admin/funnel?period=7d`, { headers: { cookie } })).json()) as { visits: { days: Array<{ views: number; uniques: number }>; topReferrers: unknown; landingVisitors: number; reachedRequestShare: number } };
    expect(body.visits.days.at(-1)).toMatchObject({ views: 2, uniques: 1 });
    expect(body.visits.topReferrers).toEqual([{ domain: 'linkedin.com', views: 1 }]);
    expect(body.visits.landingVisitors).toBe(1);
    expect(body.visits.reachedRequestShare).toBe(1);
  });
});
