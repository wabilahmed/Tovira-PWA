import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

// [P58-P2 · owner] Company and industry (P57) are editable after the client exists, in the client's Edit sheet.
// POST /clients/:id/details { company, industry }: company trimmed (empty clears it), industry from the sign-up list
// (empty clears it). The phone and everything else are untouched. Another rep's client is a 404; a client under an
// active erasure restriction can't be edited (403), like a rename.
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); base = await listenForTest(server); });
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(email = 'rep@example.com'): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const create = async (t: string) => ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(t), body: JSON.stringify({ name: 'Sara Khan', phone: '+971 50 123 4567', company: 'Emaar', industry: 'property' }) })).json()) as { id: string }).id;
const details = (t: string, id: string, body: unknown) => fetch(`${base}/clients/${id}/details`, { method: 'POST', headers: h(t), body: JSON.stringify(body) });

describe('[P58-P2] editing company and industry', () => {
  it('saves both, trimmed, and leaves the phone alone', async () => {
    const { token } = await rep();
    const id = await create(token);
    const res = await details(token, id, { company: '  Aldar Properties ', industry: 'wealth_private_banking' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ company: 'Aldar Properties', industry: 'wealth_private_banking', phone: '+971501234567', name: 'Sara Khan' });
  });
  it('empty clears either one', async () => {
    const { token } = await rep();
    const id = await create(token);
    expect(await (await details(token, id, { company: '', industry: '' })).json()).toMatchObject({ company: null, industry: null });
  });
  it('NEGATIVE: an industry outside the list is refused and nothing changes', async () => {
    const { token } = await rep();
    const id = await create(token);
    const res = await details(token, id, { company: 'Other Co', industry: 'astrology' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation', message: 'Choose an industry from the list.' });
    expect(await (await fetch(`${base}/clients/${id}`, { headers: h(token) })).json()).toMatchObject({ company: 'Emaar', industry: 'property' });
  });
  it('NEGATIVE: another rep\'s client is a 404 and is not changed', async () => {
    const a = await rep('a@example.com');
    const b = await rep('b@example.com');
    const id = await create(a.token);
    expect((await details(b.token, id, { company: 'Taken' })).status).toBe(404);
    expect(await (await fetch(`${base}/clients/${id}`, { headers: h(a.token) })).json()).toMatchObject({ company: 'Emaar' });
  });
  it('NEGATIVE: a client under an active erasure restriction can\'t be edited', async () => {
    const { token, userId } = await rep();
    const id = await create(token);
    await deps.erasureRequests.create(userId, { requesterNames: ['Sara Khan'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * 86_400_000 });
    const res = await details(token, id, { company: 'Changed' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'restricted', message: 'This client can\'t be edited while a privacy request is reviewed.' });
  });
});
