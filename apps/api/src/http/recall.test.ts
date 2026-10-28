import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

// [P39-7 · owner] The free-text Ask (POST /recall) is gone — its five route tests ([P4-8] auth, empty question,
// verbatim receipt, "I don't have that", cross-rep retrieval) went with it. The pending-capture queue stays.
describe('[ASK-CAPTURE] capture queue + confirm/reject', () => {
  async function meId(token: string): Promise<string> {
    return ((await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { id: string } }).user.id;
  }
  async function client(token: string, name: string): Promise<string> {
    return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
  }

  it('lists pending captures with their receipt; confirm clears the queue', async () => {
    const token = await signup('cap@example.com');
    const cid = await client(token, 'Sarah');
    const pending = await deps.askCapture!.capture(await meId(token), cid, 'Sarah moved to Meridian Capital', '2026-07-09');
    const q = (await (await fetch(`${base}/captures`, { headers: auth(token) })).json()) as { captures: { noteId: string; statement: string; clientName: string }[] };
    expect(q.captures).toHaveLength(1);
    expect(q.captures[0]).toMatchObject({ statement: 'Sarah moved to Meridian Capital', clientName: 'Sarah' });
    expect((await fetch(`${base}/captures/${pending!.noteId}/confirm`, { method: 'POST', headers: auth(token) })).status).toBe(200);
    expect(((await (await fetch(`${base}/captures`, { headers: auth(token) })).json()) as { captures: unknown[] }).captures).toHaveLength(0);
  });

  it('reject clears a pending capture; an unknown id is 404; unauthed is 401', async () => {
    const token = await signup('cap2@example.com');
    const cid = await client(token, 'Ahmed');
    const pending = await deps.askCapture!.capture(await meId(token), cid, 'Ahmed signed the LOI', '2026-07-09');
    expect((await fetch(`${base}/captures/${pending!.noteId}/reject`, { method: 'POST', headers: auth(token) })).status).toBe(200);
    expect((await fetch(`${base}/captures/does-not-exist/confirm`, { method: 'POST', headers: auth(token) })).status).toBe(404);
    expect((await fetch(`${base}/captures`, { method: 'GET' })).status).toBe(401);
  });
});
