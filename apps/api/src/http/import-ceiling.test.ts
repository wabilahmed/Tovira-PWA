import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// A trial account already at its seeding ceiling: extraction is refused.
let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps({}, { extractionLimiter: { allow: async () => false } });
  server = createApiServer(deps);
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

const EXPORT = [
  '[2026-01-15, 09:12:03] Sara Lee: Morning! Did the revised quote come through?',
  '[2026-01-15, 09:40:11] Alex Rep: Sending it over today.',
].join('\n');

describe('[P5-1-CEILING] import stopped by the trial seeding ceiling', () => {
  // IMPORT-ASYNC + ceiling: the upload is accepted (202) and the chat is stored
  // intact even when the trial ceiling will block extraction — nothing is lost. The
  // ceiling itself is surfaced at extraction time (the next test), not at upload.
  it('saves the imported chat pending, losing nothing, even when the ceiling will block extraction', async () => {
    const token = await signup('ceiling-import@example.com');
    const cid = await createClient(token, 'Sara Lee');

    const res = await fetch(`${base}/clients/${cid}/notes/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: EXPORT, consent: true }),
    });
    expect(res.status).toBe(202); // accepted; extraction deferred
    const body = (await res.json()) as { imported: number; status: string; note: { id: string } };
    expect(body.imported).toBeGreaterThan(0); // the processed portion is surfaced
    expect(body.status).toBe('pending_extraction');

    // The chat is stored intact — nothing lost — just not yet analysed.
    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
      notes: Array<{ source: string; status: string; messages: unknown[] | null }>;
    };
    const imported = notes.notes.find((n) => n.source === 'whatsapp_export')!;
    expect(imported.messages).not.toBeNull();
    expect((imported.messages as unknown[]).length).toBeGreaterThan(0);
    expect(imported.status).toBe('pending_extraction'); // saved, waiting — not failed

    // Draining the sweep (via /extract) surfaces the ceiling: the note stays pending.
    const ex = await fetch(`${base}/notes/${body.note.id}/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(((await ex.json()) as { status: string }).status).toBe('trial_limit');
  });

  // The per-note extract endpoint surfaces the same ceiling signal (server-side),
  // so the notes timeline can render the non-scary state without any local math.
  it('the extract endpoint reports the trial_limit status server-side', async () => {
    const token = await signup('ceiling-extract@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const paste = await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'a note to analyse' }) });
    const noteId = ((await paste.json()) as { id: string }).id;
    const ex = await fetch(`${base}/notes/${noteId}/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(ex.status).toBe(200);
    expect(((await ex.json()) as { status: string }).status).toBe('trial_limit');
  });
});
