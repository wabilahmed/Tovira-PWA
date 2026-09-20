/**
 * [ASYNC-EXTRACT task 2] /extract ACCEPTS and QUEUES — no model call in the request path.
 *
 * A synchronous extraction held a request/connection + container slot for the model's whole duration
 * and 504'd under concurrency (BATCH B). Now /extract persists+queues and returns immediately; the
 * background sweep is the processor. Proven directly by injecting a slow, counting model: /extract
 * returns fast and with ZERO model calls; the sweep is what finally calls the model.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import type { ModelClient } from '../ports/model.js';

const VALID = JSON.stringify({ summary: 'ok', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });

let server: Server;
let base: string;
let deps: TestDeps;
let modelCalls = 0;

// A model that is SLOW (2s) and counts its calls — so a request that awaited it would be slow, and a
// request that did not call it registers zero calls.
const slowCountingModel: ModelClient = {
  complete: async () => {
    modelCalls += 1;
    await new Promise((r) => setTimeout(r, 2000));
    return { text: VALID, usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

beforeAll(async () => {
  deps = buildInMemoryDeps({}, { modelClient: slowCountingModel });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) });
  return ((await res.json()) as { token: string }).token;
}

describe('[ASYNC-EXTRACT] /extract accepts and queues', () => {
  it('returns promptly with no model call in the request path — even for a large note', async () => {
    modelCalls = 0;
    const token = await signup('accept-queue@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;

    // A large note — size must not matter, because the model is never called in the request.
    const bigText = `Kai promised the signed contract by Friday. ${'filler sentence about the deal. '.repeat(3000)}`;
    const noteId = ((await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: bigText }) })).json()) as { id: string }).id;

    // /extract returns FAST (well under the model's 2s) and with the note already persisted+queued.
    const t0 = Date.now();
    const res = await fetch(`${base}/notes/${noteId}/extract`, { method: 'POST', headers: H(token) });
    const elapsed = Date.now() - t0;
    const body = (await res.json()) as { status: string; note: { id: string; status: string } };

    expect(res.status).toBe(202); // accepted, not "done"
    expect(body.status).toBe('queued');
    expect(elapsed).toBeLessThan(1000); // did NOT await the 2s model
    expect(modelCalls).toBe(0); // DIRECT: no model call happened in the request path
    // The note is persisted and queued (never lose a capture), NOT extracted inline.
    expect(body.note.status).toBe('pending_extraction');
    const promises = (await (await fetch(`${base}/promises`, { headers: H(token) })).json()) as { promises: unknown[] };
    expect(promises.promises).toHaveLength(0); // nothing extracted yet

    // The SWEEP is the processor: draining it is what finally calls the model and extracts.
    await deps.runSweep();
    expect(modelCalls).toBeGreaterThan(0);
    const after = ((await (await fetch(`${base}/clients/${clientId}/notes`, { headers: H(token) })).json()) as { notes: Array<{ id: string; status: string }> }).notes.find((n) => n.id === noteId)!;
    expect(['extracted', 'needs_review']).toContain(after.status);
  });

  it('persists the capture even if /extract is never called — the note is queued at capture', async () => {
    const token = await signup('queued-at-capture@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Beta' }) })).json()) as { id: string }).id;
    const paste = await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'A note that is captured but never explicitly extracted.' }) });
    expect(paste.status).toBe(201);
    const noteId = ((await paste.json()) as { id: string }).id;
    // Without ever calling /extract, the sweep still processes the queued note.
    await deps.runSweep();
    const note = ((await (await fetch(`${base}/clients/${clientId}/notes`, { headers: H(token) })).json()) as { notes: Array<{ id: string; status: string }> }).notes.find((n) => n.id === noteId)!;
    expect(['extracted', 'needs_review']).toContain(note.status);
  });
});
