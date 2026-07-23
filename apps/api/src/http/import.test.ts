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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { id: string }).id;
}

const EXPORT = [
  '[2026-01-15, 09:12:03] Sara Lee: Morning! Did the revised quote come through?',
  '[2026-01-15, 09:40:11] Alex Rep: Sending it over today.',
  'It has the bulk discount baked in.',
  '[2026-03-02, 14:05:00] Sara Lee: ‎<Media omitted>',
  '[2026-03-02, 14:06:00] Sara Lee: Thanks — looks good.',
].join('\n');

function importChat(token: string, clientId: string, body: unknown): Promise<Response> {
  return fetch(`${base}/clients/${clientId}/notes/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('[P1-4b] import a WhatsApp chat export', () => {
  it('imports messages with sender + timestamp in order, then runs extraction', async () => {
    const { token } = await signup('import@example.com');
    const cid = await createClient(token, 'Acme');

    const res = await importChat(token, cid, { content: EXPORT, consent: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { note: { id: string; source: string }; imported: number };
    expect(body.imported).toBe(4); // 4 messages (the continuation line folds into #2)
    expect(body.note.source).toBe('whatsapp_export');

    // Fetch the stored note — messages persisted, speaker-attributed, in order.
    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ id: string; source: string; status: string; messages: Array<{ sender: string; sentAt: string | null; body: string; media: boolean }> | null }> };
    const imported = notes.notes.find((n) => n.source === 'whatsapp_export')!;
    expect(imported.messages).toHaveLength(4);
    expect(imported.messages![0]).toMatchObject({ sender: 'Sara Lee', sentAt: '2026-01-15T09:12:03' });
    expect(imported.messages![1]!.body).toContain('bulk discount'); // multi-line folded in
    expect(imported.messages![2]!.media).toBe(true); // media placeholder flagged
    // Batch extraction ran → note reaches the extracted state.
    expect(imported.status).toBe('extracted');
  });

  // NEGATIVE: consent is required before anything is imported.
  it('does not import without explicit consent', async () => {
    const { token } = await signup('noconsent@example.com');
    const cid = await createClient(token, 'Acme');
    const res = await importChat(token, cid, { content: EXPORT, consent: false });
    expect(res.status).toBe(400);

    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: unknown[] };
    expect(notes.notes).toEqual([]); // nothing stored at all
  });

  // NEGATIVE: non-WhatsApp text is rejected; no messages written.
  it('rejects a non-WhatsApp .txt with a clear message and no partial history', async () => {
    const { token } = await signup('notwa@example.com');
    const cid = await createClient(token, 'Acme');
    const res = await importChat(token, cid, { content: 'just my notes\nno timestamps\nrandom text', consent: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/whatsapp/i);

    // The raw file may be persisted+flagged, but NO messages were written.
    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ status: string; messages: unknown[] | null }> };
    for (const n of notes.notes) {
      expect(n.messages == null || (n.messages as unknown[]).length === 0).toBe(true);
    }
    expect(notes.notes.some((n) => n.status === 'import_failed')).toBe(true);
  });

  // NEGATIVE: a rep can never import into, or read, another rep's client.
  it('does not let a rep import into another rep\'s client', async () => {
    const a = await signup('a-import@example.com');
    const b = await signup('b-import@example.com');
    const cid = await createClient(a.token, 'A-owned');
    const res = await importChat(b.token, cid, { content: EXPORT, consent: true });
    expect(res.status).toBe(404);
  });
});
