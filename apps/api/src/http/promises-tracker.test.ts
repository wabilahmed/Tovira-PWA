import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [P46-6b] Owner: every Promises row names its client and whose promise it is; the Done chip lists done promises; the
// "Older" chip is labelled with the real window ("Older than 90 days"). /promises carries all three.
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

describe('[P46-6b] GET /promises', () => {
  it('names each promise\'s client, lists done promises separately, and says the "older" window', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pt@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const client = await deps.clients.create(b.user.id, 'Sara Khan');
    await deps.facts.saveExtraction(b.user.id, { noteId: 'n1', clientId: client.id, promises: [
      { text: 'send the plan', owner: 'rep', due_date: '2026-11-01', due_raw: null, confidence: 'high' },
      { text: 'pay the deposit', owner: 'client', due_date: null, due_raw: null, confidence: 'high' },
    ] });
    const H = { authorization: `Bearer ${b.token}` };
    const first = (await (await fetch(`${base}/promises`, { headers: H })).json()) as { promises: Array<{ id: string; text: string; clientName: string | null }> };
    const plan = first.promises.find((p) => p.text === 'send the plan')!;
    await fetch(`${base}/promises/${plan.id}/done`, { method: 'POST', headers: H });
    const body = (await (await fetch(`${base}/promises`, { headers: H })).json()) as { promises: Array<{ text: string; clientName: string | null; done: boolean }>; done: Array<{ text: string; clientName: string | null; done: boolean }>; staleThresholdDays: number };
    expect(body.promises.map((p) => [p.text, p.clientName])).toEqual([['pay the deposit', 'Sara Khan']]);
    expect(body.done.map((p) => [p.text, p.clientName, p.done])).toEqual([['send the plan', 'Sara Khan', true]]);
    expect(body.staleThresholdDays).toBe(90);
  });
});
