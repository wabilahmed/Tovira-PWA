import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VisitService, VISIT_PAGES, REQUEST_STEPS, rollupOf } from '../services/visits/visits.js';
import { InMemoryVisitStore } from '../adapters/visits/in-memory-visit-store.js';

/**
 * [P90 · owner, Prompt 88] The request form is three steps now: "Add funnel events for step 1, 2 and 3 reached and add
 * them to the admin funnel card." The same cookieless beacon as a page view (POST /visit), stored on page_views as
 * request_step_1..3 with the same rules (no IP, the day's hash cleared at the end of the day). A step reached is NOT a
 * page view: it never changes the page-view, visitor, device, referrer or UTM figures.
 */
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const T0 = Date.parse('2026-11-28T09:00:00Z');
const svc = () => { const clock = { t: T0 }; const store = new InMemoryVisitStore(); return { v: new VisitService(store, () => clock.t), store, clock }; };

describe('[P90] request form steps reached', () => {
  it('the three steps are counted, with how many requests were submitted', async () => {
    const { v } = svc();
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) { await v.hit({ page: 'request_access', ip, ua: PHONE }); expect(await v.hit({ page: 'request_step_1', ip, ua: PHONE })).toBe(true); }
    for (const ip of ['1.1.1.1', '2.2.2.2']) await v.hit({ page: 'request_step_2', ip, ua: PHONE });
    await v.hit({ page: 'request_step_3', ip: '1.1.1.1', ua: PHONE });
    await v.submitted({ ip: '1.1.1.1', ua: PHONE });
    expect((await v.report(null)).requestSteps).toEqual({ step1: 3, step2: 2, step3: 1, submitted: 1 });
  });
  it('NEGATIVE: a step reached is not a page view: views, visitors, devices, pages, referrers and UTM are unchanged', async () => {
    const { v } = svc();
    await v.hit({ page: 'request_access', ip: '1.1.1.1', ua: DESK });
    const before = await v.report(null);
    await v.hit({ page: 'request_step_1', ip: '1.1.1.1', ua: DESK, referrer: 'https://linkedin.com/x', utmSource: 'li', utmCampaign: 'c' });
    await v.hit({ page: 'request_step_2', ip: '5.5.5.5', ua: PHONE });
    const after = await v.report(null);
    expect({ ...after, requestSteps: before.requestSteps }).toEqual(before);
    expect(after.requestSteps).toEqual({ step1: 1, step2: 1, step3: 0, submitted: 0 });
    expect(Object.keys(after.byPage)).toEqual([...VISIT_PAGES]);
  });
  it('NEGATIVE: a day\'s rollup ignores the steps; the counts survive the day closing (the hash does not)', async () => {
    const { v, store, clock } = svc();
    await v.hit({ page: 'landing', ip: '1.1.1.1', ua: DESK });
    await v.hit({ page: 'request_step_1', ip: '1.1.1.1', ua: DESK });
    await v.hit({ page: 'request_step_2', ip: '2.2.2.2', ua: DESK });
    expect(rollupOf('2026-11-28', store.list)).toMatchObject({ views: 1, uniques: 1 });
    clock.t += 86_400_000;
    const r = await v.report(null);
    expect(r.days[0]).toEqual({ day: '2026-11-28', views: 1, uniques: 1 });
    expect(r.requestSteps).toEqual({ step1: 1, step2: 1, step3: 0, submitted: 0 });
    expect(store.list.every((x) => x.visitorHash === null)).toBe(true);
  });
  it('NEGATIVE: no step 0 or 4, no bots, and nothing but the step is stored (no IP)', async () => {
    const { v, store } = svc();
    expect(await v.hit({ page: 'request_step_0', ip: '1.1.1.1', ua: DESK })).toBe(false);
    expect(await v.hit({ page: 'request_step_4', ip: '1.1.1.1', ua: DESK })).toBe(false);
    expect(await v.hit({ page: 'request_step_1', ip: '1.1.1.1', ua: 'Googlebot/2.1' })).toBe(false);
    await v.hit({ page: 'request_step_1', ip: '203.0.113.9', ua: DESK });
    expect(JSON.stringify(store.list)).not.toContain('203.0.113.9');
    expect(REQUEST_STEPS).toEqual(['request_step_1', 'request_step_2', 'request_step_3']);
  });
  it('the migration lets page_views hold the three steps and nothing else new (no new column)', () => {
    const sql = readFileSync(new URL('../../migrations/0122_request_steps.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS page_views_page_check/);
    expect(sql).toMatch(/CHECK \(page IN \('landing', 'request_access', 'sign_in', 'privacy', 'submitted', 'request_step_1', 'request_step_2', 'request_step_3'\)\)/);
    expect(sql).not.toMatch(/ADD COLUMN|CREATE TABLE|GRANT/i);
  });
});
