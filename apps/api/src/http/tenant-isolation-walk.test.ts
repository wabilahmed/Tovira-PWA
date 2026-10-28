import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [SEC-01 / SEC-02] The permanent cross-tenant route-walk. Rep A calls every tenant-scoped resource
 * route using rep B's ids — reads AND writes. Each must look EXACTLY like a missing record: 404 with
 * body { error: 'not_found' } — never 200, never an empty list, never a different body that would let A
 * probe whether B's id exists. And B's data must be untouched afterwards.
 *
 * ADD EVERY NEW TENANT-SCOPED :id ROUTE TO `WALK` BELOW. A route that reads/writes a client, note,
 * promise, meeting, image or inventory id by id is a cross-tenant surface; if it is not in this walk it
 * is not proven isolated. The id-shape guard at the end fails if a known resource prefix has no entry.
 */
let server: Server;
let base: string;
let deps: TestDeps;
let A: { token: string };
let B: { token: string; userId: string; clientId: string; noteId: string; promiseId: string; meetingId: string; imageId: string; inventoryId: string };

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  A = await signup('walk-a@example.com');
  const b = await signup('walk-b@example.com');
  // Seed B's resources directly through the repos (fast, deterministic) — these are the ids A will probe.
  const client = await deps.clients.create(b.userId, 'B Holdings');
  const note = await deps.notes.create(b.userId, { clientId: client.id, source: 'paste', rawText: "B's private note", audioKey: null, status: 'extracted' });
  await deps.facts.saveExtraction(b.userId, { noteId: note.id, clientId: client.id, promises: [{ text: 'send B the quote', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }] });
  const [promise] = await deps.facts.listPromisesByUser(b.userId);
  const meeting = await deps.meetings.create(b.userId, { clientId: client.id, datetime: null, datetimeRaw: 'Tuesday', title: 'B meeting', confirmed: true });
  const image = await deps.images.create(b.userId, { clientId: client.id, storageKey: 'b/img/1', contentType: 'image/png' });
  const item = await deps.inventoryRepo.create(b.userId, { title: 'B Marina 2-bed', description: 'sea view', quantity: 1, embedding: null });
  B = { ...b, clientId: client.id, noteId: note.id, promiseId: promise!.id, meetingId: meeting.id, imageId: image.id, inventoryId: item.id };
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

interface Hop { method: string; path: () => string; body?: () => unknown; resource: string }
const WALK: Hop[] = [
  // client-scoped
  { resource: 'client', method: 'GET', path: () => `/clients/${B.clientId}/notes` },
  { resource: 'client', method: 'GET', path: () => `/clients/${B.clientId}/brief` },
  { resource: 'client', method: 'POST', path: () => `/clients/${B.clientId}/notes/paste`, body: () => ({ text: 'A trying to write into B' }) },
  { resource: 'client', method: 'GET', path: () => `/clients/${B.clientId}/images` },
  { resource: 'client', method: 'POST', path: () => `/clients/${B.clientId}/meetings`, body: () => ({ datetime: '2026-07-09T15:00', datetimeRaw: '3pm' }) },
  { resource: 'client', method: 'GET', path: () => `/clients/${B.clientId}/stakeholders` },
  // note-scoped
  { resource: 'note', method: 'POST', path: () => `/notes/${B.noteId}/transcribe` },
  { resource: 'note', method: 'POST', path: () => `/notes/${B.noteId}/extract` },
  { resource: 'note', method: 'POST', path: () => `/notes/${B.noteId}/follow-up` },
  { resource: 'note', method: 'GET', path: () => `/notes/${B.noteId}/audio` },
  { resource: 'note', method: 'GET', path: () => `/notes/${B.noteId}/move-preview` },
  { resource: 'note', method: 'POST', path: () => `/notes/${B.noteId}/move`, body: () => ({ toClientId: B.clientId }) },
  // promise-scoped (write)
  { resource: 'promise', method: 'PATCH', path: () => `/promises/${B.promiseId}`, body: () => ({ text: 'A editing B' }) },
  { resource: 'promise', method: 'POST', path: () => `/promises/${B.promiseId}/done` },
  { resource: 'promise', method: 'POST', path: () => `/promises/${B.promiseId}/confirm` },
  { resource: 'promise', method: 'POST', path: () => `/promises/${B.promiseId}/restore` },
  { resource: 'promise', method: 'DELETE', path: () => `/promises/${B.promiseId}` },
  // meeting-scoped
  { resource: 'meeting', method: 'PATCH', path: () => `/meetings/${B.meetingId}`, body: () => ({ datetime: '2026-07-09T17:00', datetimeRaw: '5pm' }) },
  { resource: 'meeting', method: 'POST', path: () => `/meetings/${B.meetingId}/confirm` },
  { resource: 'meeting', method: 'DELETE', path: () => `/meetings/${B.meetingId}` },
  // image-scoped
  { resource: 'image', method: 'GET', path: () => `/images/${B.imageId}` },
  // inventory-scoped
  { resource: 'inventory', method: 'GET', path: () => `/inventory/${B.inventoryId}` },
  { resource: 'inventory', method: 'PATCH', path: () => `/inventory/${B.inventoryId}`, body: () => ({ title: 'A renaming B item' }) },
];

describe('[SEC-01/SEC-02] cross-tenant route walk', () => {
  for (const hop of WALK) {
    it(`${hop.method} ${hop.resource} by B's id, as A → 404 not_found`, async () => {
      const res = await fetch(`${base}${hop.path()}`, {
        method: hop.method,
        headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
        ...(hop.body ? { body: JSON.stringify(hop.body()) } : {}),
      });
      expect(res.status, `${hop.method} ${hop.path()} should be 404 (not a leak)`).toBe(404);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      expect(body.error, `${hop.method} ${hop.path()} body`).toBe('not_found');
    });
  }

  it("B's data is unchanged after the whole walk", async () => {
    expect((await deps.notes.listByClient(B.userId, B.clientId)).map((n) => n.rawText)).toContain("B's private note");
    expect(await deps.facts.listPromisesByUser(B.userId)).toHaveLength(1); // not deleted/edited by A
    expect((await deps.facts.listPromisesByUser(B.userId))[0]!.text).toBe('send B the quote');
    expect(await deps.meetings.findByIdForUser(B.userId, B.meetingId)).not.toBeNull();
  });

  // [SEC permanence] A known resource prefix with no walk entry is an unproven surface — fail loudly so a
  // new route can't ship without being walked.
  it('covers every resource family', () => {
    const families = new Set(WALK.map((h) => h.resource));
    for (const f of ['client', 'note', 'promise', 'meeting', 'image', 'inventory']) {
      expect(families.has(f), `no cross-tenant walk entry for resource family: ${f}`).toBe(true);
    }
  });
});
