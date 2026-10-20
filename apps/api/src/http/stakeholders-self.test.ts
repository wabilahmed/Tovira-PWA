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
  it('drops the client by name; with no client type recorded, an alias person is shown', async () => {
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
    expect(out.people.map((p) => p.name)).toEqual(['Windowed Buyer', 'Abu Khalid', 'Sara Agent'] /* [owner, 20 Oct] no client type recorded → an alias hides no one; a chat sender is never the client */);
  });
});

describe('[P36-5 · owner, 20 Oct] a company contact saved as an alias', () => {
  it('Marina Estates with alias "Khalid" → Khalid shown on the stakeholder map and in the brief', async () => {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'p36marina@example.com', password: 'password123' }) });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    const client = await deps.clients.create(user.id, 'Marina Estates');
    const note = await deps.notes.create(user.id, { clientId: client.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted',
      messages: [{ sender: 'Khalid', sentAt: '2026-01-01T10:00', body: 'can you send the floor plan?', media: false, role: 'client' }] } as never);
    await deps.aliases!.add(user.id, client.id, 'Khalid');
    await deps.notes.update(user.id, note.id, { extracted: { summary: 's', promises: [], people: [person('Khalid', 'decision_maker'), person('Marina Estates')], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } } as never);
    const auth = { authorization: `Bearer ${token}` };
    const map = (await (await fetch(`${base}/clients/${client.id}/stakeholders`, { headers: auth })).json()) as { people: Array<{ name: string }> };
    expect(map.people.map((p) => p.name)).toEqual(['Khalid']);
    const brief = (await (await fetch(`${base}/clients/${client.id}/brief`, { headers: auth })).json()) as { keyPeople: Array<{ name: string }> };
    expect(brief.keyPeople.map((p) => p.name)).toEqual(['Khalid']);
  });
});
