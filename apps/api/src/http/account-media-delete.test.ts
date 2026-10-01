import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

const bytes = (...n: number[]): Buffer => Buffer.from(n);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4); // real recorder container (passes the voice gate)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9); // real PNG (passes the image allow-list)

describe('[MEDIA-DELETE] account deletion removes the stored audio + image OBJECTS, not only the rows', () => {
  let server: Server;
  let base: string;
  let deps: TestDeps;
  let cookie: string;
  let userId: string;
  let clientId: string;

  beforeEach(async () => {
    deps = buildInMemoryDeps();
    server = createApiServer(deps);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@x.ae', password: 'password123' }) });
    cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    userId = ((await s.json()) as { user: { id: string } }).user.id;
    const c = await fetch(`${base}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Acme' }) });
    clientId = ((await c.json()) as { id: string }).id;
  });
  afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('deletes both the voice recording and the gallery image from blob storage', async () => {
    await fetch(`${base}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { 'content-type': 'audio/webm', cookie }, body: WEBM });
    await fetch(`${base}/clients/${clientId}/images`, { method: 'POST', headers: { 'content-type': 'image/png', cookie }, body: PNG });

    // Collect the actual storage keys the rows hold.
    const notes = await deps.notes.listByClient(userId, clientId);
    const images = await deps.images.listByClient(userId, clientId);
    const audioKey = notes.find((n) => n.audioKey)!.audioKey!;
    const imageKey = images[0]!.storageKey;

    // Both blobs exist before deletion (not just rows).
    expect(await deps.storage.exists(audioKey)).toBe(true);
    expect(await deps.storage.exists(imageKey)).toBe(true);

    const del = await fetch(`${base}/account`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);

    // The OBJECTS are gone, not only the DB rows.
    expect(await deps.storage.exists(audioKey)).toBe(false);
    expect(await deps.storage.exists(imageKey)).toBe(false);
  });

  it('the prefix-sweep backstop removes an ORPHAN blob under the user prefix that no row points at', async () => {
    const orphan = `audio/${userId}/orphan-no-row.webm`;
    await deps.storage.put(orphan, WEBM); // a blob with no DB row (e.g. a prior partial deletion)
    expect(await deps.storage.exists(orphan)).toBe(true);

    expect((await fetch(`${base}/account`, { method: 'DELETE', headers: { cookie } })).status).toBe(200);

    expect(await deps.storage.exists(orphan)).toBe(false); // caught by the ListObjectsV2-style backstop
  });
});
