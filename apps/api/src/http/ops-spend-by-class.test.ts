/**
 * [SPEND-INSTRUMENT B3] GET /ops/spend/by-class — ops-gated cost by feature class (with share) and by
 * model (invoice-comparable, USD), over a time window. Reads recorded per-call events, per account or in
 * aggregate. One account's view never includes another's; the aggregate reconciles to the invoice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_OPS_TOKEN, type TestDeps } from './test-deps.js';
import type { ModelCallEvent } from '../ports/model-call-event-store.js';
import type { SpendByClassReport } from '../services/spend/spend-by-class-report.js';
type ClassRow = SpendByClassReport['byClass'][number];
type ModelRow = SpendByClassReport['byModel'][number];

let server: Server;
let base: string;
let deps: TestDeps;

const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const T = Date.parse('2026-10-10T00:00:00Z');
const ev = (over: Partial<ModelCallEvent>): ModelCallEvent => ({
  userId: 'rep-A', periodKey: 'p:x', spendClass: 'extraction', model: SONNET, inputTokens: 100, outputTokens: 40,
  thinkingTokens: 10, cacheReadTokens: 4000, cacheCreationTokens: 0, cacheHit: true, costAed: 1, at: T, ...over,
});

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Seed: rep-A extraction 5 + recall 1; rep-B extraction 3; a system canary 0.5.
  await deps.modelCallEvents.record(ev({ userId: 'rep-A', spendClass: 'extraction', model: SONNET, costAed: 5 }));
  await deps.modelCallEvents.record(ev({ userId: 'rep-A', spendClass: 'recall', model: HAIKU, costAed: 1 }));
  await deps.modelCallEvents.record(ev({ userId: 'rep-B', spendClass: 'extraction', model: SONNET, costAed: 3 }));
  await deps.modelCallEvents.record(ev({ userId: null, periodKey: null, spendClass: 'canary', model: SONNET, costAed: 0.5 }));
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const WIN = `from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`;
async function get(path: string, token?: string): Promise<{ status: number; body: SpendByClassReport }> {
  const res = await fetch(`${base}${path}`, { headers: token ? { 'x-ops-token': token } : {} });
  return { status: res.status, body: (res.status === 200 ? await res.json() : {}) as SpendByClassReport };
}

describe('[SPEND-INSTRUMENT] GET /ops/spend/by-class', () => {
  it('requires the ops token (403 without it — never rep-facing)', async () => {
    expect((await get(`/ops/spend/by-class?${WIN}`)).status).toBe(403);
    expect((await get(`/ops/spend/by-class?${WIN}`, 'wrong')).status).toBe(403);
  });

  it('per account: cost by class with share of total, and invoice-comparable by-model', async () => {
    const { status, body } = await get(`/ops/spend/by-class?${WIN}&userId=rep-A`, TEST_OPS_TOKEN);
    expect(status).toBe(200);
    expect(body.scope).toBe('account');
    expect(body.total.costAed).toBe(6); // 5 + 1
    const byClass = Object.fromEntries(body.byClass.map((c: ClassRow) => [c.spendClass, c]));
    expect(byClass.extraction!.costAed).toBe(5);
    expect(byClass.extraction!.shareOfTotal).toBeCloseTo(5 / 6, 3);
    expect(byClass.recall!.shareOfTotal).toBeCloseTo(1 / 6, 3);
    // by-model = the invoice line: per model, in USD.
    const byModel = Object.fromEntries(body.byModel.map((m: ModelRow) => [m.model, m]));
    expect(byModel[SONNET]!.costAed).toBe(5);
    expect(byModel[HAIKU]!.costAed).toBe(1);
    expect(byModel[SONNET]!.costUsd).toBeGreaterThan(0); // billed currency
  });

  it('aggregate (no userId) includes every account AND system — reconciles to the invoice total', async () => {
    const { body } = await get(`/ops/spend/by-class?${WIN}`, TEST_OPS_TOKEN);
    expect(body.scope).toBe('all');
    expect(body.total.costAed).toBe(9.5); // 5 + 1 + 3 + 0.5 (system canary included)
    const byClass = Object.fromEntries(body.byClass.map((c: ClassRow) => [c.spendClass, c]));
    expect(byClass.extraction!.costAed).toBe(8); // rep-A 5 + rep-B 3
    expect(byClass.canary!.costAed).toBe(0.5); // system, charged to no account, but in the invoice total
  });

  it('isolation: one account\'s view never includes another\'s', async () => {
    const a = (await get(`/ops/spend/by-class?${WIN}&userId=rep-A`, TEST_OPS_TOKEN)).body;
    const b = (await get(`/ops/spend/by-class?${WIN}&userId=rep-B`, TEST_OPS_TOKEN)).body;
    expect(a.total.costAed).toBe(6);
    expect(b.total.costAed).toBe(3); // only rep-B's extraction, not rep-A's 6 or the system 0.5
    expect(b.byClass.every((c: ClassRow) => c.spendClass === 'extraction')).toBe(true);
  });
});
