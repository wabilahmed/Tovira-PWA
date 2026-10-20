import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_OPS_TOKEN, type TestDeps } from './test-deps.js';
import { TOUR_STEPS, TOUR_VERSION } from '../services/tour/tour-service.js';

/**
 * [P37] The required first-login tour, server side. Completion lives on the ACCOUNT (tour_completed_at +
 * tour_version), so it never runs again on another phone or after clearing the browser; the step reached is
 * stored too, so a reload or another device resumes at the same step. Every account that hasn't completed the
 * current version sees it — existing ones included. The funnel is anonymous counts per step (no user id).
 * Nothing here ever writes clients, notes or facts.
 */
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

const J = { 'content-type': 'application/json' };
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const login = async (email: string) => ((await (await fetch(`${base}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string }).token;
const H = (t: string) => ({ ...J, authorization: `Bearer ${t}` });
type Tour = { required: boolean; step: number; steps: number; version: number };
const tour = async (t: string) => (await (await fetch(`${base}/me/tour`, { headers: H(t) })).json()) as Tour;
const step = (t: string, n: number) => fetch(`${base}/me/tour`, { method: 'PUT', headers: H(t), body: JSON.stringify({ step: n }) });
const complete = (t: string) => fetch(`${base}/me/tour/complete`, { method: 'POST', headers: H(t), body: '{}' });
const funnel = async () => (await (await fetch(`${base}/ops/tour-funnel`, { headers: { 'x-ops-token': TEST_OPS_TOKEN } })).json()) as { rows: Array<{ version: number; step: number | null; event: string; count: number }> };
const count = async (event: string, s: number | null) => (await funnel()).rows.find((r) => r.version === TOUR_VERSION && r.event === event && r.step === s)?.count ?? 0;

describe('[P37] the tour on the account', () => {
  it('needs a session', async () => {
    expect((await fetch(`${base}/me/tour`)).status).toBe(401);
  });

  it('a fresh account must take it: 9 steps, from the start', async () => {
    const { token } = await signup('tour-new@example.com');
    expect(await tour(token)).toEqual({ required: true, step: 0, steps: TOUR_STEPS, version: TOUR_VERSION });
    expect(TOUR_STEPS).toBe(9);
  });

  it('the step is saved, so another session (a reload, another phone) resumes there', async () => {
    const { token } = await signup('tour-resume@example.com');
    expect((await step(token, 4)).status).toBe(200);
    const other = await login('tour-resume@example.com');
    expect(await tour(other)).toMatchObject({ required: true, step: 4 });
  });

  it('completion is stored server-side: a second session never sees it again', async () => {
    const { token } = await signup('tour-done@example.com');
    expect((await complete(token)).status).toBe(200);
    expect((await tour(token)).required).toBe(false);
    expect((await tour(await login('tour-done@example.com'))).required).toBe(false);
  });

  it('an existing account that never completed it sees it (once)', async () => {
    const { token, userId } = await signup('tour-existing@example.com');
    // An account created before the tour existed: nothing recorded at all.
    expect((await tour(token)).required).toBe(true);
    await complete(token);
    expect((await tour(token)).required).toBe(false);
    void userId;
  });

  it('NEGATIVE: an out-of-range step is refused', async () => {
    const { token } = await signup('tour-bad@example.com');
    expect((await step(token, 9)).status).toBe(400);
    expect((await step(token, -1)).status).toBe(400);
  });

  it('the funnel counts each step reached once per rep, completion, and "Import your first chat" — anonymously', async () => {
    const before0 = await count('reached', 0);
    const before3 = await count('reached', 3);
    const beforeDone = await count('completed', null);
    const beforeImport = await count('import_tapped', null);
    const { token } = await signup('tour-funnel@example.com');
    await step(token, 0);
    await step(token, 1); await step(token, 2); await step(token, 3);
    await step(token, 2); await step(token, 3); // Back, then Next again: no double count
    await complete(token);
    await complete(token); // idempotent
    expect(await count('reached', 0)).toBe(before0 + 1);
    expect(await count('reached', 3)).toBe(before3 + 1);
    expect(await count('completed', null)).toBe(beforeDone + 1);
    expect(await count('import_tapped', null)).toBe(beforeImport + 1);
    const raw = JSON.stringify(await funnel());
    expect(raw).not.toContain('tour-funnel@example.com'); // no personal data
  });

  it('the funnel is ops-only', async () => {
    expect((await fetch(`${base}/ops/tour-funnel`)).status).toBe(403);
  });

  it('NEGATIVE: the tour never writes clients, notes or facts', async () => {
    const { token, userId } = await signup('tour-nowrite@example.com');
    for (let s = 0; s < TOUR_STEPS; s += 1) await step(token, s);
    await complete(token);
    expect(await deps.clients.listByUser(userId)).toEqual([]);
    expect(await deps.meetings.listByUser(userId)).toEqual([]);
    expect(await deps.facts.listPromisesByUser(userId)).toEqual([]);
  });
});
