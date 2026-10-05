import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [TASK 2] End-to-end: while a third-party erasure request is in its review window, that counterparty's
// messages and facts are WITHHELD from every surface (book shows a placeholder, brief/answer/pointers
// omit them) but are NEVER deleted — they stay in the export, and the restriction lifts on withdraw.

let server: Server;
let base: string;
let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const DAY = 86_400_000;
const EXTRACTED = {
  summary: 'A chat about a listing.', promises: [], people: [{ name: 'Khalid', role: null, reports_to: null, decision_role: 'decision_maker', notes: null }, { name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
  personal_facts: [{ subject: 'Khalid', fact: 'collects watches', category: 'background', source_span: null, source_message_at: null }],
  key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [{ sender: 'Khalid', question: 'can you send the floor plan?' }],
};

async function seed(): Promise<{ token: string; userId: string; clientId: string; noteId: string }> {
  const { token, userId } = await signup('rep@example.com');
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Marina Estates' }) })).json()) as { id: string }).id;
  const note = await deps.notes.create(userId, {
    clientId, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: 'Khalid: can you send the floor plan?\nRep: yes, today',
    messages: [
      { sentAt: '2026-01-01T10:00:00', sender: 'Khalid', body: 'can you send the floor plan?', media: false, role: 'client' },
      { sentAt: '2026-01-01T10:01:00', sender: 'Rep', body: 'yes, today', media: false, role: 'rep' },
    ],
  });
  await deps.notes.update(userId, note.id, { extracted: EXTRACTED as unknown as never, embedding: [1, 0, 0] });
  return { token, userId, clientId, noteId: note.id };
}

/** Open a restriction for the given names by creating an active (pending) erasure request. */
async function restrict(userId: string, names: string[]): Promise<string> {
  const now = Date.now();
  const req = await deps.erasureRequests.create(userId, { requesterNames: names, requestedAt: now, windowEndsAt: now + 10 * DAY });
  return req.id;
}

describe('[TASK 2] processing restriction during the erasure window', () => {
  it('the book shows a placeholder for a restricted note, with its content withheld (but still stored)', async () => {
    const { token, userId, clientId, noteId } = await seed();
    await restrict(userId, ['Khalid']);
    const body = (await (await fetch(`${base}/clients/${clientId}/notes`, { headers: auth(token) })).json()) as { notes: Array<{ id: string; restricted?: boolean; restrictionNotice?: string; messages: Array<{ sender: string }> | null; rawText: string | null }> };
    const n = body.notes.find((x) => x.id === noteId)!;
    expect(n.restricted).toBe(true);
    expect(n.restrictionNotice).toBe('Restricted while a privacy request is reviewed.');
    expect((n.messages ?? []).some((m) => m.sender === 'Khalid')).toBe(false); // withheld
    // The stored note is intact underneath — the server never deleted it.
    expect((await deps.notes.findByIdForUser(userId, noteId))!.messages!.some((m) => m.sender === 'Khalid')).toBe(true);
  });

  it('the brief omits the restricted counterparty but keeps everyone else', async () => {
    const { token, userId, clientId } = await seed();
    await restrict(userId, ['Khalid']);
    const brief = (await (await fetch(`${base}/clients/${clientId}/brief`, { headers: auth(token) })).json()) as { keyPeople: Array<{ name: string }>; personalNotes: Array<{ subject: string }> };
    expect(brief.keyPeople.map((p) => p.name)).toEqual(['Omar']); // Khalid withheld
    expect(brief.personalNotes.some((p) => p.subject === 'Khalid')).toBe(false);
  });

  it('an answer (recall) never quotes the restricted counterparty', async () => {
    const { token, userId } = await seed();
    await restrict(userId, ['Khalid']);
    const ans = (await (await fetch(`${base}/recall`, { method: 'POST', headers: auth(token), body: JSON.stringify({ question: 'what did they ask?' }) })).json()) as { receipts: Array<{ quote: string }> };
    expect(ans.receipts.every((r) => !r.quote.includes('floor plan'))).toBe(true); // Khalid's message withheld
  });

  it('pointers citing the restricted counterparty are withheld from the thread card', async () => {
    const { token, userId, clientId } = await seed();
    await deps.clientPointers!.save(userId, clientId, { pointers: [
      { section: 'relationship', text: 'Khalid pushes hard on price', receipts: [] },
      { section: 'relationship', text: 'Omar prefers email', receipts: [] },
    ], retrospectiveDisclosure: null }, Date.now());
    await restrict(userId, ['Khalid']);
    const body = (await (await fetch(`${base}/clients/${clientId}/pointers`, { headers: auth(token) })).json()) as { pointers: Array<{ text: string }> };
    expect(body.pointers.map((p) => p.text)).toEqual(['Omar prefers email']);
  });

  it('the export STILL includes the restricted content — it is withheld, not deleted', async () => {
    const { token, userId } = await seed();
    await restrict(userId, ['Khalid']);
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { notes: Array<{ rawText: string; messages?: Array<{ sender: string }> | null }> };
    expect(data.notes.some((n) => (n.rawText ?? '').includes('floor plan') || (n.messages ?? []).some((m) => m.sender === 'Khalid'))).toBe(true);
  });

  it('withdrawing the request lifts the restriction — the content surfaces again', async () => {
    const { token, userId, clientId, noteId } = await seed();
    const reqId = await restrict(userId, ['Khalid']);
    // restricted now
    expect((((await (await fetch(`${base}/clients/${clientId}/brief`, { headers: auth(token) })).json()) as { keyPeople: Array<{ name: string }> }).keyPeople).map((p) => p.name)).toEqual(['Omar']);
    // withdraw → lift
    await deps.erasureRequests.setStatus(userId, reqId, 'withdrawn');
    const brief = (await (await fetch(`${base}/clients/${clientId}/brief`, { headers: auth(token) })).json()) as { keyPeople: Array<{ name: string }> };
    expect(brief.keyPeople.map((p) => p.name).sort()).toEqual(['Khalid', 'Omar']);
    const book = (await (await fetch(`${base}/clients/${clientId}/notes`, { headers: auth(token) })).json()) as { notes: Array<{ id: string; restricted?: boolean }> };
    expect(book.notes.find((x) => x.id === noteId)!.restricted).toBeUndefined(); // no longer restricted
  });
});
