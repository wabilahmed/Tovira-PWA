/**
 * [SPEND-INSTRUMENT B4 · ASK-CONVO] GET /ops/spend/conversation — per-turn cost for one conversation,
 * ops-gated. Makes conversation cost growth visible (turn number, context size, cost, running total).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_OPS_TOKEN, type TestDeps } from './test-deps.js';
import type { ModelCallEvent } from '../ports/model-call-event-store.js';
import type { ConversationCostReport } from '../services/spend/conversation-cost-report.js';

let server: Server;
let base: string;
let deps: TestDeps;
const HAIKU = 'claude-haiku-4-5-20251001';
const T = Date.parse('2026-10-10T00:00:00Z');
const turn = (turnIndex: number, over: Partial<ModelCallEvent> = {}): ModelCallEvent => ({
  userId: 'rep-A', periodKey: 'p:x', spendClass: 'recall', model: HAIKU, inputTokens: 500 + turnIndex * 100,
  outputTokens: 150, thinkingTokens: 0, cacheReadTokens: 700, cacheCreationTokens: 0, cacheHit: true,
  costAed: 0.01 * turnIndex, at: T + turnIndex, conversationId: 'sess-1', turnIndex, ...over,
});

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await deps.modelCallEvents.record(turn(1));
  await deps.modelCallEvents.record(turn(2));
  await deps.modelCallEvents.record(turn(3));
  await deps.modelCallEvents.record(turn(1, { conversationId: 'sess-2' })); // rep-A, other conversation
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function get(path: string, token?: string): Promise<{ status: number; body: ConversationCostReport }> {
  const res = await fetch(`${base}${path}`, { headers: token ? { 'x-ops-token': token } : {} });
  return { status: res.status, body: (res.status === 200 ? await res.json() : {}) as ConversationCostReport };
}

describe('[SPEND-INSTRUMENT] GET /ops/spend/conversation', () => {
  it('requires the ops token (never rep-facing)', async () => {
    expect((await get('/ops/spend/conversation?userId=rep-A&conversationId=sess-1')).status).toBe(403);
  });

  it('validates userId + conversationId', async () => {
    expect((await get('/ops/spend/conversation?userId=rep-A', TEST_OPS_TOKEN)).status).toBe(400);
  });

  it('returns per-turn cost in turn order with a running total, scoped to the one conversation', async () => {
    const { status, body } = await get('/ops/spend/conversation?userId=rep-A&conversationId=sess-1', TEST_OPS_TOKEN);
    expect(status).toBe(200);
    expect(body.total.turns).toBe(3); // sess-2 excluded
    expect(body.turns.map((t) => t.turnIndex)).toEqual([1, 2, 3]);
    expect(body.turns.map((t) => t.contextTokens)).toEqual([1300, 1400, 1500]); // (500+100t)+700 cache-read
    const cum = body.turns.map((t) => t.cumulativeCostAed);
    expect(cum[2]).toBeGreaterThan(cum[0]!); // running total grows
    expect(body.total.costAed).toBeCloseTo(0.06, 6); // 0.01 + 0.02 + 0.03
  });
});
