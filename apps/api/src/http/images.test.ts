import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return ((await res.json()) as { id: string }).id;
}
const img = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
function upload(token: string, clientId: string): Promise<Response> {
  return fetch(`${base}/clients/${clientId}/images`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: img });
}

describe('[P4-6] client gallery', () => {
  it('uploads an image, lists it, and serves it back (persists server-side)', async () => {
    const token = await signup('gallery@example.com');
    const clientId = await createClient(token, 'Gallery Corp');
    const created = (await (await upload(token, clientId)).json()) as { id: string };
    const list = (await (await fetch(`${base}/clients/${clientId}/images`, { headers: { authorization: `Bearer ${token}` } })).json()) as { images: Array<{ id: string }> };
    expect(list.images.map((i) => i.id)).toContain(created.id);
    const bytes = new Uint8Array(await (await fetch(`${base}/images/${created.id}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
    expect([...bytes]).toEqual([...img]);
  });

  // NEGATIVE: another rep cannot access the image by id (authorised access only).
  it('does not let another rep access an image by id (404)', async () => {
    const a = await signup('a-gal@example.com');
    const b = await signup('b-gal@example.com');
    const clientA = await createClient(a, 'A Gallery');
    const image = (await (await upload(a, clientA)).json()) as { id: string };
    expect((await fetch(`${base}/images/${image.id}`, { headers: { authorization: `Bearer ${b}` } })).status).toBe(404);
  });

  it('rejects an empty upload (400), cross-tenant client (404), and unauth (401)', async () => {
    const token = await signup('gal-val@example.com');
    const clientId = await createClient(token, 'Val');
    expect((await fetch(`${base}/clients/${clientId}/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: new Uint8Array([]) })).status).toBe(400);
    const other = await signup('other-gal@example.com');
    const otherClient = await createClient(other, 'Other');
    expect((await upload(token, otherClient)).status).toBe(404);
    expect((await fetch(`${base}/clients/${clientId}/images`, { method: 'POST', body: img })).status).toBe(401);
  });
});
