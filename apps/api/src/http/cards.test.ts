import { describe, it, expect, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { StubCardScanner } from '../adapters/vision/stub-card-scanner.js';

async function startWith(scanner: StubCardScanner) {
  const deps = buildInMemoryDeps({ cardScanner: scanner });
  const server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}
async function token(base: string, email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const image = new Uint8Array([1, 2, 3, 4]);

describe('[P4-5] business-card scan', () => {
  let server: Server;
  let base: string;
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it('scans a clear card into a structured contact (proposal, nothing saved)', async () => {
    ({ server, base } = await startWith(new StubCardScanner({ isCard: true, contact: { name: 'Jane Doe', title: 'CTO', phone: '555-1', email: 'jane@x.com' } })));
    const t = await token(base, 'card@example.com');
    const res = await fetch(`${base}/cards/scan`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'image/jpeg' }, body: image });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isCard: boolean; contact: { name: string } };
    expect(body.isCard).toBe(true);
    expect(body.contact.name).toBe('Jane Doe');
  });

  // NEGATIVE: blurry/partial → unread fields blank, not guessed.
  it('leaves unreadable fields null rather than guessing', async () => {
    ({ server, base } = await startWith(new StubCardScanner({ isCard: true, contact: { name: 'Sam', title: null, phone: null, email: null } })));
    const t = await token(base, 'blurry@example.com');
    const res = await fetch(`${base}/cards/scan`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: image });
    const body = (await res.json()) as { contact: { title: string | null; phone: string | null } };
    expect(body.contact.title).toBeNull();
    expect(body.contact.phone).toBeNull();
  });

  // NEGATIVE: a non-card image is detected, not turned into an invented contact.
  it('reports a non-card image', async () => {
    ({ server, base } = await startWith(new StubCardScanner({ isCard: false, contact: null })));
    const t = await token(base, 'noncard@example.com');
    const res = await fetch(`${base}/cards/scan`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: image });
    const body = (await res.json()) as { isCard: boolean; contact: unknown };
    expect(body.isCard).toBe(false);
    expect(body.contact).toBeNull();
  });

  it('rejects an empty upload (400) and unauth (401)', async () => {
    ({ server, base } = await startWith(new StubCardScanner()));
    const t = await token(base, 'cardval@example.com');
    expect((await fetch(`${base}/cards/scan`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: new Uint8Array([]) })).status).toBe(400);
    expect((await fetch(`${base}/cards/scan`, { method: 'POST', body: image })).status).toBe(401);
  });
});
