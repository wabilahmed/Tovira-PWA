import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { FIRST_IMPORT_NOTICE } from '../ports/import-ack-repository.js';

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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function makeClient(token: string): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Ahmed' }) })).json()) as { id: string }).id;
}
const CHAT = '01/01/2026, 10:00 - Ahmed: hello\n01/01/2026, 10:01 - Me: hi there';
function importChat(token: string, clientId: string, extra: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/clients/${clientId}/notes/import`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ content: CHAT, consent: true, ...extra }),
  });
}

// [PRIVACY-5] Before the FIRST chat-export upload in an account, the rep must acknowledge they have
// the right to upload messages written by other people. Once per account, stored with a timestamp,
// server-side (survives logout), tenant-scoped. Declining blocks the import and changes nothing else.
describe('[PRIVACY-5] first-import acknowledgement', () => {
  it('shows the notice on the first import and blocks it; records nothing (declining changes nothing)', async () => {
    const { token, userId } = await signup('ack-first@example.com');
    const clientId = await makeClient(token);
    const res = await importChat(token, clientId, {}); // no firstImportAck → declining
    expect(res.status).toBe(428);
    expect((await res.json() as { notice: string }).notice).toBe(FIRST_IMPORT_NOTICE);
    expect(await deps.importAck.acknowledgedAt(userId)).toBeNull(); // nothing recorded
    // Nothing else changed: no note was created for the client.
    const notes = (await (await fetch(`${base}/clients/${clientId}/notes`, { headers: auth(token) })).json()) as { notes: unknown[] };
    expect(notes.notes).toEqual([]);
  });

  it('accepting records the timestamp and lets the import proceed; the second import shows no notice', async () => {
    const { token, userId } = await signup('ack-accept@example.com');
    const clientId = await makeClient(token);
    const accepted = await importChat(token, clientId, { firstImportAck: true });
    expect(accepted.status).not.toBe(428); // proceeded past the acknowledgement gate
    const at = await deps.importAck.acknowledgedAt(userId);
    expect(typeof at).toBe('number'); // timestamp recorded
    // A later import needs no acknowledgement — the notice is once per account.
    const second = await importChat(token, clientId, {}); // no firstImportAck
    expect(second.status).not.toBe(428);
    // The acknowledgement is server-stored (survives logout) and immutable (first write wins).
    expect(await deps.importAck.acknowledgedAt(userId)).toBe(at);
  });

  it('is tenant-scoped: one account\'s acknowledgement does not cover another', async () => {
    const a = await signup('ack-tenantA@example.com');
    const b = await signup('ack-tenantB@example.com');
    const aClient = await makeClient(a.token);
    const bClient = await makeClient(b.token);
    await importChat(a.token, aClient, { firstImportAck: true }); // A acknowledges
    expect(await deps.importAck.acknowledgedAt(b.userId)).toBeNull();
    // B still hits the notice on their own first import.
    expect((await importChat(b.token, bClient, {})).status).toBe(428);
  });
});
