import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';
import { VisitService, referrerDomain, isBot, deviceOf } from '../services/visits/visits.js';
import { InMemoryVisitStore } from '../adapters/visits/in-memory-visit-store.js';

// [P63-7 · owner] Site visits, cookieless and first-party: page views on the landing page, request access, sign-in and
// the privacy page; unique visitors per day by a hash of IP + user agent + a daily salt that rotates and is thrown away.
// No raw IP stored, the hash not kept beyond the day, no cookies. Referrer domain only, UTM source and campaign, phone or
// desktop. Bots and signed-in admins don't count.
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-05T09:00:00Z');

function svc(): { v: VisitService; store: InMemoryVisitStore; clock: { t: number } } {
  const clock = { t: T0 };
  const store = new InMemoryVisitStore();
  return { v: new VisitService(store, () => clock.t), store, clock };
}

describe('[P63-7] the visit counter', () => {
  it('counts page views and unique visitors per day; the same browser twice is one visitor', async () => {
    const { v } = svc();
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    await v.hit({ page: 'landing', ip: '2.2.2.2', ua: DESK });
    const r = await v.report(null);
    expect(r.days).toEqual([{ day: '2026-11-05', views: 3, uniques: 2 }]);
    expect(r.devices).toEqual({ phone: 2, desktop: 1 });
  });
  it('NEGATIVE: no raw IP is ever stored, and the hash is not kept beyond the day', async () => {
    const { v, store, clock } = svc();
    await v.hit({ page: 'landing', ip: '203.0.113.7', ua: PHONE });
    expect(JSON.stringify(store.list)).not.toContain('203.0.113.7');
    expect(store.list[0]!.visitorHash).toMatch(/^[0-9a-f]{64}$/);
    clock.t += DAY; // the next day: the first hit (or report) closes yesterday
    await v.hit({ page: 'landing', ip: '198.51.100.1', ua: DESK });
    expect(store.list.filter((x) => x.day === '2026-11-05').every((x) => x.visitorHash === null)).toBe(true);
    // yesterday's counts survive as numbers only
    expect((await v.report(null)).days).toEqual([{ day: '2026-11-05', views: 1, uniques: 1 }, { day: '2026-11-06', views: 1, uniques: 1 }]);
  });
  it('the daily salt rotates and the old one is thrown away: the same browser tomorrow is a new hash', async () => {
    const { v, store, clock } = svc();
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    const salt1 = store.salts.get('2026-11-05');
    const h1 = store.list[0]!.visitorHash;
    clock.t += DAY;
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    expect(store.salts.has('2026-11-05')).toBe(false); // thrown away
    expect(store.salts.get('2026-11-06')).not.toBe(salt1);
    expect(store.list.at(-1)!.visitorHash).not.toBe(h1);
  });
  it('NEGATIVE: bots, crawlers, health checks and empty user agents are not counted', async () => {
    const { v } = svc();
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'ELB-HealthChecker/2.0', 'curl/8.4.0', 'facebookexternalhit/1.1', 'Mozilla/5.0 HeadlessChrome/120', '']) {
      expect(await v.hit({ page: 'landing', ip: '1.1.1.1', ua })).toBe(false);
    }
    expect(isBot(DESK)).toBe(false);
    expect((await v.report(null)).days[0]!.views).toBe(0);
  });
  it('NEGATIVE: a signed-in admin\'s visits that day are not counted (and earlier ones that day are dropped)', async () => {
    const { v } = svc();
    await v.hit({ page: 'landing', ip: '9.9.9.9', ua: DESK });
    await v.markAdmin({ ip: '9.9.9.9', ua: DESK });
    expect(await v.hit({ page: 'request_access', ip: '9.9.9.9', ua: DESK })).toBe(false);
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    expect((await v.report(null)).days[0]).toEqual({ day: '2026-11-05', views: 1, uniques: 1 });
  });
  it('captures the referrer\'s domain only, and UTM source and campaign', async () => {
    const { v, store } = svc();
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE, referrer: 'https://www.LinkedIn.com/feed/update/urn:li:activity:123?x=1', utmSource: 'LinkedIn', utmCampaign: 'Dubai-Brokers' });
    expect(store.list[0]).toMatchObject({ referrerDomain: 'linkedin.com', utmSource: 'linkedin', utmCampaign: 'dubai-brokers', device: 'phone' });
    expect(JSON.stringify(store.list)).not.toContain('urn:li');
    expect(referrerDomain('https://tovira.io/request-access')).toBeNull(); // our own site is not a referrer
    expect(referrerDomain('not a url')).toBeNull();
    expect(deviceOf(DESK)).toBe('desktop');
    const r = await v.report(null);
    expect(r.topReferrers).toEqual([{ domain: 'linkedin.com', views: 1 }]);
    expect(r.utm).toEqual([{ source: 'linkedin', campaign: 'dubai-brokers', views: 1 }]);
  });
  it('the share of landing-page visitors who reach request access, and who submit', async () => {
    const { v } = svc();
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: PHONE });
    await v.hit({ page: 'request_access', ip: '1.1.1.1', ua: PHONE });
    await v.submitted({ ip: '1.1.1.1', ua: PHONE });
    await v.hit({ page: 'landing', ip: '2.2.2.2', ua: DESK });
    await v.hit({ page: 'request_access', ip: '2.2.2.2', ua: DESK });
    await v.hit({ page: 'landing', ip: '3.3.3.3', ua: DESK });
    await v.hit({ page: 'landing', ip: '4.4.4.4', ua: DESK });
    const r = await v.report(null);
    expect({ landing: r.landingVisitors, reached: r.reachedRequest, submitted: r.submitted }).toEqual({ landing: 4, reached: 2, submitted: 1 });
    expect(r.reachedRequestShare).toBe(0.5);
    expect(r.submittedShare).toBe(0.25);
    expect(r.days[0]!.views).toBe(6); // a submission is not a page view
  });
  it('NEGATIVE: an unknown page is not counted', async () => {
    const { v } = svc();
    expect(await v.hit({ page: 'app', ip: '1.1.1.1', ua: DESK })).toBe(false);
  });
});

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ url: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  return { url: await listenForTest(server!), deps };
}
const beacon = (url: string, body: unknown, ua = PHONE, ip = '5.5.5.5') => fetch(`${url}/visit`, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-forwarded-for': ip }, body: JSON.stringify(body) });

describe('[P63-7] POST /visit', () => {
  it('records a view and answers 204 with no body; NEGATIVE: it never sets a cookie', async () => {
    const { url, deps } = await start();
    const r = await beacon(url, { page: 'landing', referrer: 'https://google.com/search?q=x', utmSource: 'google' });
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(await r.text()).toBe('');
    expect(deps.visitStore.list).toHaveLength(1);
    expect(deps.visitStore.list[0]).toMatchObject({ page: 'landing', referrerDomain: 'google.com', utmSource: 'google' });
    expect(JSON.stringify(deps.visitStore.list)).not.toContain('5.5.5.5');
  });
  it('NEGATIVE: a bad body or a bot is still 204 and records nothing', async () => {
    const { url, deps } = await start();
    expect((await fetch(`${url}/visit`, { method: 'POST', body: 'not json', headers: { 'user-agent': PHONE } })).status).toBe(204);
    expect((await beacon(url, { page: 'landing' }, 'Googlebot/2.1')).status).toBe(204);
    expect(deps.visitStore.list).toHaveLength(0);
  });
  it('NEGATIVE: once an admin has used the console today, that browser\'s visits are not counted', async () => {
    const { url, deps } = await start();
    const { cookie } = await signInAdmin(url, deps);
    await fetch(`${url}/admin/funnel`, { headers: { cookie, 'user-agent': DESK, 'x-forwarded-for': '7.7.7.7' } });
    await beacon(url, { page: 'landing' }, DESK, '7.7.7.7');
    expect(deps.visitStore.list).toHaveLength(0);
    await beacon(url, { page: 'landing' }, DESK, '8.8.8.8');
    expect(deps.visitStore.list).toHaveLength(1);
  });
  it('a submitted request form is recorded for the share who submit', async () => {
    const { url, deps } = await start();
    const REQ = { fullName: 'Dana Rep', workEmail: 'dana@brokerage.ae', phone: '+971 50 123 4567', companyName: 'Meridian Real Estate', roleTitle: 'Senior Broker', ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-998877', conversationOwnership: 'brokerage_i_manage', expectedVolume: '50_200', industry: 'property', confirmationAccepted: true };
    const r = await fetch(`${url}/access-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': PHONE, 'x-forwarded-for': '6.6.6.6' }, body: JSON.stringify(REQ) });
    expect(r.status).toBe(201);
    expect(deps.visitStore.list.map((x) => x.page)).toEqual(['submitted']);
  });
  it('the pages send the beacon: landing and privacy from the static pages, request access and sign-in from the app', () => {
    const read = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
    expect(read('apps/web/src/marketing/main.ts')).toMatch(/sendVisit\('landing'\)/);
    expect(read('apps/web/privacy/index.html')).toMatch(/src="\/src\/marketing\/visit-privacy\.ts"/);
    expect(read('apps/web/src/App.tsx')).toMatch(/sendVisit\('request_access'\)/);
    expect(read('apps/web/src/App.tsx')).toMatch(/sendVisit\('sign_in'\)/);
  });
});

describe('[P63-7] the tables', () => {
  it('no IP column; hashes and salts kept per day only; owner plane', () => {
    const sql = readFileSync(new URL('../../migrations/0112_site_visits.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, ''); // the columns, not the comments
    expect(sql).not.toMatch(/\bip\b|ip_address|inet/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS visit_salts \(day date PRIMARY KEY/);
    expect(sql).not.toMatch(/GRANT .* TO tovira_app/);
  });
});
