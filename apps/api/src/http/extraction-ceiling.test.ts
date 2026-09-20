/**
 * [TRIAL-FARM task 3] At the extraction ceiling, extraction refuses — but capture, export and delete
 * keep working (degrade, never break; a rep is never locked out of their own data). The ceiling is
 * read from the DURABLE counter, so this drives it by seeding that counter, not by 100 real calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { periodKeyFrom } from '../services/spend/period.js';

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

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

describe('[TRIAL-FARM] extraction ceiling degrades, capture/export/delete survive', () => {
  it('at the ceiling: extraction defers (trial_limit) but capture/export still work; delete works', async () => {
    // Signup + verify (so verification is not what's blocking us — we are testing the CEILING).
    const { token, userId } = await (async () => {
      const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ceiling@example.com', password: 'password123', consent: true }) });
      const b = (await res.json()) as { token: string; user: { id: string } };
      return { token: b.token, userId: b.user.id };
    })();
    const vtoken = await deps.auth.createEmailVerification(userId);
    await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: vtoken }) });

    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;

    // Seed the durable counter to the trial ceiling (100 in test-deps) for this trial's period bucket.
    const ent = await deps.billing.entitlement(userId, Date.now());
    const pk = periodKeyFrom({ status: ent.status, trialEndsAt: ent.trialEndsAt, renewsAt: ent.renewsAt, periodStart: ent.periodStart }, Date.now()).key;
    for (let i = 0; i < 100; i++) await deps.extractionCounter.increment(userId, pk);

    // Capture STILL works — the note is stored (never lose a capture), it simply queues.
    const noteId = ((await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'Kai promised the deposit by Friday.' }) })).json()) as { id: string }).id;

    // Extraction is refused at the ceiling — before any model call — and the note stays pending.
    const ex = (await (await fetch(`${base}/notes/${noteId}/extract`, { method: 'POST', headers: H(token) })).json()) as { status: string };
    expect(ex.status).toBe('trial_limit');
    const note = ((await (await fetch(`${base}/clients/${clientId}/notes`, { headers: H(token) })).json()) as { notes: Array<{ id: string; status: string }> }).notes.find((n) => n.id === noteId)!;
    expect(note.status).toBe('pending_extraction');

    // Export still works at the ceiling.
    expect((await fetch(`${base}/account/export`, { headers: H(token) })).status).toBe(200);
    // Delete still works at the ceiling.
    expect((await fetch(`${base}/account`, { method: 'DELETE', headers: H(token) })).status).toBe(200);
  });
});
