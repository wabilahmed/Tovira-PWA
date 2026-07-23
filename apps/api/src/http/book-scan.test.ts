import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<{ token: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return { token: ((await res.json()) as { token: string }).token };
}

describe('[P5-3b] Book Scan endpoint', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/book-scan`)).status).toBe(401);
  });

  it('returns an honest empty report for a fresh account, ending with an invitation', async () => {
    const { token } = await signup('bookscan@example.com');
    const res = await fetch(`${base}/book-scan`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; isEmpty: boolean; invitation: string };
    expect(body.items).toEqual([]);
    expect(body.isEmpty).toBe(true);
    expect(body.invitation).toMatch(/export/i);
  });

  it('surfaces an imported unanswered question with its receipt (end-to-end)', async () => {
    const { token } = await signup('bookscan2@example.com');
    // Create a client whose name matches the chat speaker, then import a thread
    // that ends on the client's question.
    const cid = ((await (await fetch(`${base}/clients`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sara Lee' }),
    })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${cid}/notes/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        consent: true,
        content: [
          '[2026-01-15, 09:00:00] Alex: here is the quote',
          '[2026-01-16, 10:00:00] Sara Lee: Can you do bulk pricing?',
        ].join('\n'),
      }),
    });

    const body = (await (await fetch(`${base}/book-scan`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { items: Array<{ kind: string; receipt: { quote: string; date: string | null } }> };
    const q = body.items.find((i) => i.kind === 'unanswered_question')!;
    expect(q).toBeTruthy();
    expect(q.receipt.quote).toContain('bulk pricing');
    // Trust rule: every rendered item carries a receipt.
    for (const item of body.items) {
      expect(item.receipt.quote.trim().length).toBeGreaterThan(0);
      expect(item.receipt.date).toBeTruthy();
    }
  });
});
