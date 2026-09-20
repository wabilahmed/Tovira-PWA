/**
 * [TRIAL-FARM task 2] Email verification gates EXTRACTION ONLY.
 *
 * The doctrine "soft verification never gates access" was right for reading, browsing and
 * capturing — but never meant to cover an operation that spends money on demand. So the ONE
 * gated action is extraction (the only one with unbounded external cost). Everything else
 * stays open: signup, login, browsing, capture, export, delete. An unverified rep can use
 * the product and their notes queue; they extract the moment they verify. Nothing is lost.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps({}, { enforceVerification: true }); // exercise the real emailVerified gate
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
async function paste(token: string, clientId: string, text: string): Promise<string> {
  const r = await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text }) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
async function noteStatus(token: string, clientId: string, noteId: string): Promise<string> {
  const notes = ((await (await fetch(`${base}/clients/${clientId}/notes`, { headers: H(token) })).json()) as { notes: Array<{ id: string; status: string }> }).notes;
  return notes.find((n) => n.id === noteId)?.status ?? 'unknown';
}

describe('[TRIAL-FARM] verification gates extraction only', () => {
  it('an UNVERIFIED account: capture/export/delete work, but extraction does NOT run', async () => {
    const { token } = await signup('unverified-extract@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;

    // Capture still stores the note (never lose a capture) — it just queues.
    const noteId = await paste(token, clientId, 'Kai promised to send the signed contract by Friday.');

    // The sweep is the processor, and it SKIPS an unverified rep — the note stays queued (not
    // extracted, not failed, retry budget untouched), no facts written, no model spend.
    await deps.runSweep();
    expect(await noteStatus(token, clientId, noteId)).toBe('pending_extraction');
    const promises = (await (await fetch(`${base}/promises`, { headers: H(token) })).json()) as { promises: unknown[] };
    expect(promises.promises).toHaveLength(0);

    // Export still works (own data is never locked away).
    expect((await fetch(`${base}/account/export`, { headers: H(token) })).status).toBe(200);
  });

  it('VERIFYING then lets the queued note extract on the next sweep', async () => {
    const { token, userId } = await signup('verify-then-extract@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    const noteId = await paste(token, clientId, 'Kai promised to send the signed contract by Friday.');
    await deps.runSweep();
    expect(await noteStatus(token, clientId, noteId)).toBe('pending_extraction'); // waits while unverified

    // Verify the email (mint + consume a real token, the production path).
    const vtoken = await deps.auth.createEmailVerification(userId);
    await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: vtoken }) });

    // Now the sweep extracts it.
    await deps.runSweep();
    expect(['extracted', 'needs_review']).toContain(await noteStatus(token, clientId, noteId));
  });

  it('a VERIFIED account is unaffected (the sweep extracts normally)', async () => {
    const { token, userId } = await signup('already-verified@example.com');
    const vtoken = await deps.auth.createEmailVerification(userId);
    await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: vtoken }) });
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    const noteId = await paste(token, clientId, 'Kai promised to send the signed contract by Friday.');
    await deps.runSweep();
    expect(['extracted', 'needs_review']).toContain(await noteStatus(token, clientId, noteId));
  });
});
