import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P36-7] Tovira never changes a status by itself. What the existing logic infers (gone quiet past the
 * going-cold threshold; the nightly lost_inferred outcome) is offered as a SUGGESTION — a To Confirm card —
 * and reading the suggestions changes nothing.
 */
let server: Server;
let base: string;
let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

describe('[P36-7] GET /clients/status-suggestions', () => {
  it('suggests Done (Lost) for a lost_inferred client — and reading it changes no status', async () => {
    const { token, userId } = await signup('sugg@example.com');
    const quiet = await deps.clients.create(userId, 'QA Enter Key Client');
    await deps.clients.create(userId, 'Active Client');
    await deps.clients.setOutcome(userId, quiet.id, 'lost_inferred', 'inferred', Date.now());
    const res = await fetch(`${base}/clients/status-suggestions`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: Array<{ clientId: string; clientName: string; status: string; outcome?: string; reason: string }> };
    expect(body.suggestions).toEqual([expect.objectContaining({ clientId: quiet.id, clientName: 'QA Enter Key Client', status: 'done', outcome: 'lost' })]);
    const after = await deps.clients.findByIdForUser(userId, quiet.id);
    expect(after!.leadStatus).toBeNull();
    expect(after!.outcome).toBe('lost_inferred');
  });

  it('NEGATIVE: once the rep has marked it, there is no suggestion', async () => {
    const { token, userId } = await signup('sugg2@example.com');
    const c = await deps.clients.create(userId, 'Marked Client');
    await deps.clients.setOutcome(userId, c.id, 'lost_inferred', 'inferred', Date.now());
    await deps.clients.setLeadStatus(userId, c.id, 'done', Date.now());
    const body = (await (await fetch(`${base}/clients/status-suggestions`, { headers: { authorization: `Bearer ${token}` } })).json()) as { suggestions: unknown[] };
    expect(body.suggestions).toEqual([]);
  });

  it('needs a session', async () => {
    expect((await fetch(`${base}/clients/status-suggestions`)).status).toBe(401);
  });
});
