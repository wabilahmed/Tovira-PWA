import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P36-5] Phone, QA Windowed Buyer 2: the stakeholder map listed the client himself under "Others". The client
 * is never a stakeholder of their own record — not by their client name, not by a learned alias. Everyone else stays.
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

const person = (name: string, decision_role = 'unknown') => ({ name, role: null, reports_to: null, decision_role, notes: null });

describe('[P36-5] the client is not in their own stakeholder map', () => {
  it('drops the client (name, alias) and keeps the other people', async () => {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'p36sh@example.com', password: 'password123' }) });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    const client = await deps.clients.create(user.id, 'QA Windowed Buyer 2');
    const note = await deps.notes.create(user.id, {
      clientId: client.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted',
      messages: [{ sender: 'Windowed Buyer', sentAt: '2026-05-01T09:00', body: 'looking for a villa', role: 'client' }],
    } as never);
    await deps.aliases!.add(user.id, client.id, 'Abu Khalid');
    await deps.notes.update(user.id, note.id, { extracted: { people: [person('QA Windowed Buyer 2'), person('Windowed Buyer'), person('Abu Khalid'), person('Sara Agent', 'influencer')] } });
    const out = (await (await fetch(`${base}/clients/${client.id}/stakeholders`, { headers: { authorization: `Bearer ${token}` } })).json()) as { people: Array<{ name: string }> };
    expect(out.people.map((p) => p.name)).toEqual(['Windowed Buyer', 'Sara Agent'] /* a chat sender is kept: for a company client it is a real stakeholder */);
  });
});
