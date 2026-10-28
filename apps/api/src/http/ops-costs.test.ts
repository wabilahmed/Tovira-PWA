import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_OPS_TOKEN } from './test-deps.js';
import { InMemoryCostReportStore } from '../adapters/spend/in-memory-cost-report-store.js';
import { CostReportService } from '../services/spend/cost-report-service.js';
import { listenForTest } from '../test-support/listen.js';

/** [P44-2] GET /ops/costs — the ops cost report (ops token, like /ops/access), as JSON or CSV. Read-only. */
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const OCT = Date.parse('2026-10-01T09:00:00Z');

async function start() {
  const store = new InMemoryCostReportStore().seed({
    calls: [{ userId: 'u1', periodKey: `p:${OCT}`, spendClass: 'extraction', costAed: 70, at: OCT + 3_600_000 }],
    capSpend: [{ userId: 'u1', periodKey: `p:${OCT}`, aed: 70 }],
  });
  await store.recordRevenue({ stripeId: 'in_1', userId: 'u1', kind: 'subscription', amountFils: 29900, currency: 'aed', paidAt: OCT, periodKey: `p:${OCT}` });
  const deps = buildInMemoryDeps();
  deps.opsRoute = { ...deps.opsRoute!, costReport: new CostReportService(store, async (id) => (id === 'u1' ? 'layla@x.io' : null), async () => 45) };
  server = createApiServer(deps);
  await listenForTest(server!);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const get = (base: string, path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { 'x-ops-token': token } : {} });

describe('[P44-2] GET /ops/costs', () => {
  it('NEGATIVE: without the ops token → 403', async () => {
    expect((await get(await start(), '/ops/costs')).status).toBe(403);
  });

  it('billing period by default: the row, its margin and both flags', async () => {
    const body = (await (await get(await start(), '/ops/costs', TEST_OPS_TOKEN)).json()) as { view: string; ceilingAed: number; rows: Array<Record<string, unknown>>; totals: unknown[] };
    expect(body.view).toBe('period');
    expect(body.ceilingAed).toBe(67);
    expect(body.rows[0]).toMatchObject({ email: 'layla@x.io', claudeAed: 70, revenueAed: 299, marginAed: 229, overCeiling: true, cap: { capAed: 45, spentAed: 70, reached: true } });
    expect(body.totals).toHaveLength(1);
  });

  it('?view=month groups by calendar month', async () => {
    const body = (await (await get(await start(), '/ops/costs?view=month', TEST_OPS_TOKEN)).json()) as { view: string; rows: Array<{ key: string; cap: unknown }> };
    expect(body.view).toBe('month');
    expect(body.rows.map((r) => r.key)).toEqual(['2026-10']);
    expect(body.rows[0]!.cap).toBeNull();
  });

  it('?format=csv downloads a CSV', async () => {
    const res = await get(await start(), '/ops/costs?format=csv', TEST_OPS_TOKEN);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="tovira-costs-period-\d{4}-\d{2}-\d{2}\.csv"/);
    expect((await res.text()).split('\n')[0]).toMatch(/^period,email,plan,claude_aed/);
  });

  it('NEGATIVE: an unknown view is refused', async () => {
    expect((await get(await start(), '/ops/costs?view=week', TEST_OPS_TOKEN)).status).toBe(400);
  });
});
