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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

// A real client (as in prod — notes always hang off a client row) plus a note carrying the extraction.
async function clientWithNote(userId: string, extracted: unknown): Promise<string> {
  const client = await deps.clients.create(userId, 'Insights Co');
  const note = await deps.notes.create(userId, { clientId: client.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
  await deps.notes.update(userId, note.id, { extracted });
  return client.id;
}

describe('[P4-2/P4-3] stakeholder map + personal facts endpoints', () => {
  it('returns the stakeholder map for a client', async () => {
    const { token, userId } = await signup('sh@example.com');
    const clientId = await clientWithNote(userId, { people: [{ name: 'Jordan', role: 'VP', reports_to: null, decision_role: 'decision_maker', notes: null }] });
    const res = await fetch(`${base}/clients/${clientId}/stakeholders`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { people: Array<{ name: string }> }).people[0]!.name).toBe('Jordan');
  });

  it('returns personal facts attributed to the subject', async () => {
    const { token, userId } = await signup('pf@example.com');
    const clientId = await clientWithNote(userId, { personal_facts: [{ subject: 'Sarah', fact: 'son started college', category: 'family' }] });
    const res = await fetch(`${base}/clients/${clientId}/personal-facts`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { facts: Array<{ subject: string }> };
    expect(body.facts[0]!.subject).toBe('Sarah');
  });

  // [SEC-01] Another rep's client is 404 (a missing record), not a 200 with an empty list.
  it('does not leak another rep\'s stakeholders/facts', async () => {
    const a = await signup('a-sh@example.com');
    const b = await signup('b-sh@example.com');
    const clientId = await clientWithNote(a.userId, { people: [{ name: 'Secret', role: null, reports_to: null, decision_role: 'unknown', notes: null }] });
    const res = await fetch(`${base}/clients/${clientId}/stakeholders`, { headers: { authorization: `Bearer ${b.token}` } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
  });

  it('requires auth (401)', async () => {
    expect((await fetch(`${base}/clients/x/stakeholders`)).status).toBe(401);
    expect((await fetch(`${base}/clients/x/personal-facts`)).status).toBe(401);
  });
});
