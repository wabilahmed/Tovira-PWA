/**
 * [ASYNC-EXTRACT task 4] A rep watching an import must never be unsure whether it worked. Every note
 * exposes a rep-facing extractionState (queued → processing → done | failed) and the client-notes
 * response carries the aggregate. A failed extraction surfaces as FAILED, not a silent spinner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import type { ModelClient } from '../ports/model.js';

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function start(modelClient?: ModelClient): Promise<{ server: Server; base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps({}, modelClient ? { modelClient } : {});
  const server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, deps };
}
async function signup(base: string, email: string): Promise<string> {
  return ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) })).json()) as { token: string }).token;
}
async function notesOf(base: string, token: string, clientId: string): Promise<{ notes: Array<{ id: string; extractionState: string }>; extraction: { queued: number; processing: number; done: number; failed: number; total: number } }> {
  return (await (await fetch(`${base}/clients/${clientId}/notes`, { headers: H(token) })).json()) as never;
}

describe('[ASYNC-EXTRACT] extraction visibility (per-note state + aggregate)', () => {
  let server: Server; let base: string; let deps: TestDeps;
  beforeAll(async () => { ({ server, base, deps } = await start()); });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('transitions queued → done, and the aggregate tracks it', async () => {
    const token = await signup(base, 'vis-done@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'Kai promised the deposit by Friday.' }) });

    // Right after capture: queued.
    let view = await notesOf(base, token, clientId);
    expect(view.notes[0]!.extractionState).toBe('queued');
    expect(view.extraction).toMatchObject({ queued: 1, processing: 0, done: 0, failed: 0, total: 1 });

    // After the sweep: done.
    await deps.runSweep();
    view = await notesOf(base, token, clientId);
    expect(view.notes[0]!.extractionState).toBe('done');
    expect(view.extraction).toMatchObject({ done: 1, failed: 0, total: 1 });
  });
});

describe('[ASYNC-EXTRACT] a failed extraction surfaces as failed (not stuck)', () => {
  let server: Server; let base: string; let deps: TestDeps;
  // A model that always returns unparseable text → extraction can't parse → needs_review (terminal).
  const brokenModel: ModelClient = { complete: async () => ({ text: 'not json at all', usage: { inputTokens: 0, outputTokens: 0 } }) };
  beforeAll(async () => { ({ server, base, deps } = await start(brokenModel)); });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('a note whose extraction fails reads as FAILED, never as still-processing', async () => {
    const token = await signup(base, 'vis-failed@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Beta' }) })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'some note the model will choke on' }) });

    await deps.runSweep(); // the sweep runs extraction; the broken model → needs_review
    const view = await notesOf(base, token, clientId);
    expect(view.notes[0]!.extractionState).toBe('failed'); // NOT 'processing' / 'queued' / a spinner
    expect(view.extraction).toMatchObject({ failed: 1, done: 0, processing: 0, queued: 0, total: 1 });
  });
});
