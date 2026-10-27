import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [P49-1] Owner: a rep can rename a client. A chat export often names someone "Khalid Dubai Marina" or "+971 50…" and the
// rep was stuck with it. POST /clients/:id/name { name, confirmDuplicate? }: trimmed, never empty, at most 80 characters;
// another client with the same name is a warning, never a merge; the old name is kept as a "previous name" so the next
// chat (still labelled the old way in WhatsApp) finds the same client; every rename is recorded (old, new, when); a client
// under an active erasure restriction can't be renamed.
let server: Server;
let base: string;
let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const DAY = 86_400_000;
const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(email = 'rep@example.com'): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const create = async (t: string, name: string) => ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(t), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
const rename = (t: string, id: string, body: unknown) => fetch(`${base}/clients/${id}/name`, { method: 'POST', headers: h(t), body: JSON.stringify(body) });
const get = async (t: string, id: string) => (await (await fetch(`${base}/clients/${id}`, { headers: h(t) })).json()) as { name: string; nameLocked?: boolean };

describe('[P49-1] renaming a client', () => {
  it('renames, trimmed, and the client and the list both show the new name', async () => {
    const { token } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    const res = await rename(token, id, { name: '  Khalid Al Mansoori  ' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { client: { name: string }; previousName: string })).toMatchObject({ client: { name: 'Khalid Al Mansoori' }, previousName: 'Khalid Dubai Marina' });
    expect((await get(token, id)).name).toBe('Khalid Al Mansoori');
    const list = (await (await fetch(`${base}/clients`, { headers: h(token) })).json()) as { clients: Array<{ id: string; name: string }> };
    expect(list.clients.find((c) => c.id === id)!.name).toBe('Khalid Al Mansoori');
  });

  it('NEGATIVE: an empty (or all-space) name is refused and nothing changes', async () => {
    const { token } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    for (const name of ['', '   ', undefined]) {
      const res = await rename(token, id, { name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'validation', message: 'A client name is required.' });
    }
    expect((await get(token, id)).name).toBe('Khalid Dubai Marina');
  });

  it('NEGATIVE: 81 characters is refused; 80 is accepted', async () => {
    const { token } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    const long = await rename(token, id, { name: 'k'.repeat(81) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'validation', message: 'Keep the name to 80 characters or fewer.' });
    expect((await get(token, id)).name).toBe('Khalid Dubai Marina');
    expect((await rename(token, id, { name: 'k'.repeat(80) })).status).toBe(200);
  });

  it('NEGATIVE: another client with that exact name is a warning, not a merge; confirming saves both as separate clients', async () => {
    const { token } = await rep();
    await create(token, 'Sara Khan');
    const id = await create(token, 'Sara K Dubai');
    const warned = await rename(token, id, { name: ' sara khan ' });
    expect(warned.status).toBe(409);
    expect(await warned.json()).toEqual({ error: 'duplicate_name', message: 'You already have a client called Sara Khan. Save anyway?' });
    expect((await get(token, id)).name).toBe('Sara K Dubai'); // nothing saved until the rep confirms
    expect((await rename(token, id, { name: 'sara khan', confirmDuplicate: true })).status).toBe(200);
    const list = (await (await fetch(`${base}/clients`, { headers: h(token) })).json()) as { clients: Array<{ id: string; name: string }> };
    expect(list.clients.filter((c) => c.name.toLowerCase() === 'sara khan')).toHaveLength(2); // never merged
  });

  it('the old name is kept as a previous name, and each rename is recorded (old, new, when)', async () => {
    const { token, userId } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    const before = Date.now();
    await rename(token, id, { name: 'Khalid Al Mansoori' });
    expect(await deps.aliases!.listByClientWithKind(userId, id)).toEqual([{ alias: 'Khalid Dubai Marina', kind: 'previous_name' }]);
    const hist = await deps.clients.listNameHistory(userId, id);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ oldName: 'Khalid Dubai Marina', newName: 'Khalid Al Mansoori' });
    expect(hist[0]!.changedAt).toBeGreaterThanOrEqual(before);
  });

  it('Undo is a rename back: the old name returns, and both changes are on the record', async () => {
    const { token, userId } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    await rename(token, id, { name: 'Khalid Al Mansoori' });
    expect((await rename(token, id, { name: 'Khalid Dubai Marina', confirmDuplicate: true })).status).toBe(200);
    expect((await get(token, id)).name).toBe('Khalid Dubai Marina');
    expect((await deps.clients.listNameHistory(userId, id)).map((r) => r.newName)).toEqual(['Khalid Al Mansoori', 'Khalid Dubai Marina']);
  });

  it('the same name again is a no-op: nothing recorded', async () => {
    const { token, userId } = await rep();
    const id = await create(token, 'Khalid');
    expect((await rename(token, id, { name: ' Khalid ' })).status).toBe(200);
    expect(await deps.clients.listNameHistory(userId, id)).toEqual([]);
    expect(await deps.aliases!.listByClientWithKind(userId, id)).toEqual([]);
  });

  it('NEGATIVE: a client under an active erasure restriction can\'t be renamed, and says so; the restriction lifting allows it', async () => {
    const { token, userId } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    const other = await create(token, 'Omar');
    const req = await deps.erasureRequests.create(userId, { requesterNames: ['Khalid Dubai Marina'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect((await get(token, id)).nameLocked).toBe(true);
    expect((await get(token, other)).nameLocked).toBeUndefined();
    const res = await rename(token, id, { name: 'Somebody Else' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'restricted', message: 'This client can\'t be renamed while a privacy request is reviewed.' });
    expect((await get(token, id)).name).toBe('Khalid Dubai Marina');
    const list = (await (await fetch(`${base}/clients`, { headers: h(token) })).json()) as { clients: Array<{ id: string; nameLocked?: boolean }> };
    expect(list.clients.find((c) => c.id === id)!.nameLocked).toBe(true);
    await deps.erasureRequests.setStatus(userId, req.id, 'withdrawn');
    expect((await rename(token, id, { name: 'Somebody Else' })).status).toBe(200);
  });

  it('NEGATIVE: another rep\'s client is a 404, and is not renamed', async () => {
    const a = await rep('a@example.com');
    const b = await rep('b@example.com');
    const id = await create(a.token, 'Khalid');
    expect((await rename(b.token, id, { name: 'Taken' })).status).toBe(404);
    expect((await get(a.token, id)).name).toBe('Khalid');
  });
});
