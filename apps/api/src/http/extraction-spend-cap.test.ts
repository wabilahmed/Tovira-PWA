/**
 * [SPEND-INSTRUMENT] Now that extraction is metered, a rep can hit the spend cap on extraction — and
 * extraction must QUEUE, never fail. The sweep skips spend-capped reps (leaving the note UNTOUCHED — no
 * attempt bump, never needs_review), so a capped rep's extraction simply waits. This path was never
 * exercised for extraction before (extraction was unmetered, so it never reached the cap); here it is,
 * end to end.
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
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

describe('[SPEND-INSTRUMENT] at-cap extraction queues (sweep skip), never fails', () => {
  it('a spend-capped rep\'s extraction stays queued and UNTOUCHED; capture + export still work', async () => {
    const { token, userId } = await signup('spend-capped@example.com');
    // Push the rep to their (trial) spend cap — as metered extraction now would.
    await deps.spend.recordAed(userId, 'extraction', 20);
    expect(await deps.spend.canSpend(userId)).toBe(false);

    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    // Capture still works at the cap (never lose a capture) — the note queues.
    const noteId = ((await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'Kai promised the deposit by Friday.' }) })).json()) as { id: string }).id;

    await deps.runSweep();

    // The sweep SKIPS the capped rep: the note is left exactly as captured — queued, not failed, and its
    // retry budget untouched (attempt count 0). This is the sweep skip, not the extraction gate (which
    // would have bumped the attempt count).
    const note = (await deps.notes.findByIdForUser(userId, noteId))!;
    expect(note.status).toBe('pending_extraction');
    expect(note.sweepAttempts).toBe(0); // UNTOUCHED — no attempt bump
    const promises = (await (await fetch(`${base}/promises`, { headers: H(token) })).json()) as { promises: unknown[] };
    expect(promises.promises).toHaveLength(0); // nothing extracted, nothing spent

    // Export + delete still work at the cap.
    expect((await fetch(`${base}/account/export`, { headers: H(token) })).status).toBe(200);
    expect((await fetch(`${base}/account`, { method: 'DELETE', headers: H(token) })).status).toBe(200);
  });

  it('an UNCAPPED rep\'s extraction runs normally (the skip is specific to being capped)', async () => {
    const { token, userId } = await signup('spend-ok@example.com');
    expect(await deps.spend.canSpend(userId)).toBe(true); // fresh rep, no spend
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Beta' }) })).json()) as { id: string }).id;
    const noteId = ((await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'a note to analyse' }) })).json()) as { id: string }).id;
    await deps.runSweep();
    const note = (await deps.notes.findByIdForUser(userId, noteId))!;
    expect(['extracted', 'needs_review']).toContain(note.status); // processed, not skipped
  });
});
