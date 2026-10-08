import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [USAGE-ALLOWANCE · D14] The runtime kill-switch admin route is token-gated and fail-closed.
const TOKEN = 'test-ops-token';
let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[USAGE-ALLOWANCE · D14] POST /ops/ai-pause', () => {
  it('without the ops token: forbidden (fail-closed), and the flag is unchanged', async () => {
    const res = await fetch(`${base}/ops/ai-pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) });
    expect(res.status).toBe(403);
    expect(await deps.aiPause.getPaused()).toBe(false);
  });

  it('with the ops token: sets and clears the runtime flag', async () => {
    const h = { 'content-type': 'application/json', 'x-ops-token': TOKEN };
    const on = await fetch(`${base}/ops/ai-pause`, { method: 'POST', headers: h, body: JSON.stringify({ paused: true }) });
    expect(on.status).toBe(200);
    expect(await deps.aiPause.getPaused()).toBe(true);
    const peek = await fetch(`${base}/ops/ai-pause`, { headers: { 'x-ops-token': TOKEN } });
    expect((await peek.json() as { paused: boolean }).paused).toBe(true);

    const off = await fetch(`${base}/ops/ai-pause`, { method: 'POST', headers: h, body: JSON.stringify({ paused: false }) });
    expect(off.status).toBe(200);
    expect(await deps.aiPause.getPaused()).toBe(false);
  });

  it('rejects a non-boolean body', async () => {
    const res = await fetch(`${base}/ops/ai-pause`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ops-token': TOKEN }, body: JSON.stringify({ paused: 'yes' }) });
    expect(res.status).toBe(400);
  });
});

describe('[AUDIT item 4] /allowance/status surfaces the ops AI-pause flag', () => {
  it('aiPaused reflects the ops kill switch (so the app can show a reason)', async () => {
    const su = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'paused@example.com', password: 'password123' }) });
    const token = ((await su.json()) as { token: string }).token;
    const h = { authorization: `Bearer ${token}` };
    const before = (await (await fetch(`${base}/allowance/status`, { headers: h })).json()) as { aiPaused?: boolean };
    expect(before.aiPaused).toBe(false);
    await deps.aiPause.setPaused(true);
    const after = (await (await fetch(`${base}/allowance/status`, { headers: h })).json()) as { aiPaused?: boolean };
    expect(after.aiPaused).toBe(true);
    await deps.aiPause.setPaused(false);
  });
});
