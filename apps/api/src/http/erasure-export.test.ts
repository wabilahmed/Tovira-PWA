import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [P48 · owner] The export withholds the restricted person too. Until now the rep's export kept everything during an
// erasure review (TASK 2: "restriction is not deletion"). Owner decision (pending the lawyer's confirmation): the
// export is a surface like any other, so while the request is reviewed it carries what the rep's book shows: their
// messages, the facts read from them, pointers and glossary entries naming them and Find turns about them are
// withheld; the export says so; nothing is deleted, and withdrawing the request brings it all back.

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

const MARK = 'ZEBRAQUARTZ'; // every word Khalid (restricted) said, or that was read from him
const KEEP = 'MOONLITCEDAR'; // every word Omar (not restricted) said, or that was read from him
const DAY = 86_400_000;
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function seed(): Promise<{ token: string; userId: string; clientId: string; noteId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) });
  const { token, user } = (await res.json()) as { token: string; user: { id: string } };
  const u = user.id;
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Marina Estates' }) })).json()) as { id: string }).id;
  const K = `${MARK} can you send the floor plan?`;
  const O = `${KEEP} I prefer email`;
  const note = await deps.notes.create(u, {
    clientId, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: `Khalid: ${K}\nOmar: ${O}\nRep: yes, today`,
    messages: [
      { sentAt: '2026-01-01T10:00', sender: 'Khalid', body: K, media: false, role: 'client' },
      { sentAt: '2026-01-01T10:01', sender: 'Omar', body: O, media: false, role: 'client' },
      { sentAt: '2026-01-01T10:02', sender: 'Rep', body: 'yes, today', media: false, role: 'rep' },
    ],
  });
  await deps.notes.update(u, note.id, { extracted: {
    summary: 'A chat about a listing.', promises: [], requirements: [],
    people: [{ name: 'Khalid', role: `${MARK} buyer`, reports_to: null, decision_role: 'decision_maker', notes: null }, { name: 'Omar', role: `${KEEP} partner`, reports_to: null, decision_role: 'unknown', notes: null }],
    personal_facts: [{ subject: 'Khalid', fact: `${MARK} collects watches`, category: 'background', source_span: K, source_message_at: '2026-01-01T10:00' }, { subject: 'Omar', fact: `${KEEP} sails`, category: 'background', source_span: O, source_message_at: '2026-01-01T10:01' }],
    key_dates: [], concerns: [], next_steps: [], meeting: null,
    unanswered_questions: [{ sender: 'Khalid', question: K }],
  } as never, embedding: [1, 0, 0] });
  await deps.facts.saveExtraction(u, { noteId: note.id, clientId, promises: [
    { text: `Send the ${MARK} floor plan`, owner: 'rep', due_date: '2026-02-01', due_raw: '01/02/2026', confidence: 'high', source_span: K, source_message_at: '2026-01-01T10:00' },
    { text: `Email the ${KEEP} brochure`, owner: 'rep', due_date: '2026-02-02', due_raw: '02/02/2026', confidence: 'high', source_span: O, source_message_at: '2026-01-01T10:01' },
  ], keyDates: [
    { description: `${MARK} lease ends`, date: '2026-12-01', date_raw: '01/12/2026', type: 'deadline', source_span: K, source_message_at: '2026-01-01T10:00' },
    { description: `${KEEP} lease ends`, date: '2026-12-02', date_raw: '02/12/2026', type: 'deadline', source_span: O, source_message_at: '2026-01-01T10:01' },
  ] });
  await deps.meetings.create(u, { clientId, datetime: '2026-02-10T11:00:00.000Z', datetimeRaw: `${MARK} viewing`, title: null, confirmed: true, noteId: note.id, sourceSpan: K, sourceMessageAt: '2026-01-01T10:00', captureAt: '2026-01-03' });
  await deps.meetings.create(u, { clientId, datetime: '2026-02-11T11:00:00.000Z', datetimeRaw: `${KEEP} viewing`, title: null, confirmed: true, noteId: note.id, sourceSpan: O, sourceMessageAt: '2026-01-01T10:01', captureAt: '2026-01-03' });
  await deps.clientPointers!.save(u, clientId, { pointers: [
    { section: 'relationship', text: `Khalid (${MARK}) pushes on price`, receipts: [] },
    { section: 'relationship', text: `Omar (${KEEP}) prefers email`, receipts: [] },
  ], retrospectiveDisclosure: null }, Date.now());
  await deps.repGlossary.upsert(u, 'Kalid', 'Khalid', Date.now());
  await deps.repGlossary.upsert(u, 'Omer', 'Omar', Date.now());
  const sid = await deps.recallSessions.activeSession(u, Date.now(), 30 * 60 * 1000);
  await deps.recallSessions.appendMessage(u, sid, 'user', `what did Khalid say about ${MARK}?`, Date.now());
  await deps.recallSessions.appendMessage(u, sid, 'user', `what did Omar say about ${KEEP}?`, Date.now());
  return { token, userId: u, clientId, noteId: note.id };
}

const restrict = async (userId: string): Promise<string> =>
  (await deps.erasureRequests.create(userId, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY })).id;
const exported = async (token: string): Promise<string> => {
  const res = await fetch(`${base}/account/export`, { headers: auth(token) });
  expect(res.status).toBe(200);
  return res.text();
};

describe('[P48] the export withholds a restricted person while their request is reviewed', () => {
  it('before any request the export carries both people (the fixture really holds the data)', async () => {
    const { token } = await seed();
    const text = await exported(token);
    expect(text).toContain(MARK);
    expect(text).toContain(KEEP);
    expect(text).toContain('Kalid');
  });

  it('during the review nothing of the restricted person is in the export, and nothing of anyone else is lost', async () => {
    const { token, userId } = await seed();
    const before = JSON.parse(await exported(token)) as Record<string, unknown>;
    await restrict(userId);
    const text = await exported(token);
    expect(text, 'the restricted person is in the export').not.toContain(MARK);
    expect(text, 'a glossary entry naming them is in the export').not.toContain('Kalid');
    // everyone else's data is still there, field by field
    const after = JSON.parse(text) as Record<string, unknown>;
    for (const field of ['notes', 'promises', 'keyDates', 'meetings', 'clientPointers', 'recallSessions'])
      expect(JSON.stringify(after[field]), `${field} lost the other person's data`).toContain(KEEP);
    expect(JSON.stringify(after.repGlossary)).toContain('Omer');
    expect((after.clients as unknown[]).length).toBe((before.clients as unknown[]).length);
  });

  it('the export says data is withheld, and flags the restricted note the way the book does', async () => {
    const { token, userId, noteId } = await seed();
    expect(JSON.parse(await exported(token)).restrictionNotice).toBeUndefined();
    await restrict(userId);
    const data = JSON.parse(await exported(token)) as { restrictionNotice?: string; notes: Array<{ id: string; restricted?: boolean; restrictionNotice?: string }> };
    expect(data.restrictionNotice).toBe('Some data is restricted while a privacy request is reviewed. It is not deleted: it will be in your export again when the review ends, unless it is erased.');
    const n = data.notes.find((x) => x.id === noteId)!;
    expect(n.restricted).toBe(true);
    expect(n.restrictionNotice).toBe('Restricted while a privacy request is reviewed.');
  });

  // [P49] The export now carries each client's rename history; it and the contact aliases are name records too, so an
  // entry naming the restricted person is withheld during the review like a glossary entry naming them.
  it('NEGATIVE: contact aliases and rename history naming the restricted person are withheld; everyone else\'s stay', async () => {
    const { token, userId, clientId } = await seed();
    await deps.aliases!.add(userId, clientId, 'Khalid DXB');
    await deps.aliases!.add(userId, clientId, 'Omar DXB');
    const other = await deps.clients.create(userId, 'Khalid Office');
    await deps.clients.rename(userId, other.id, 'Harbour Homes', Date.now());
    const kept = await deps.clients.create(userId, 'Omar Office');
    await deps.clients.rename(userId, kept.id, 'Bay Homes', Date.now());
    expect(await exported(token)).toContain('Khalid DXB');
    await restrict(userId);
    const data = JSON.parse(await exported(token)) as { contactAliases: Array<{ alias: string }>; clientNameHistory: Array<{ oldName: string; newName: string }> };
    expect(data.contactAliases.map((x) => x.alias)).toEqual(['Omar DXB']);
    expect(data.clientNameHistory.map((x) => x.oldName)).toEqual(['Omar Office']);
  });

  it('it is withheld, not deleted: the stored records are intact and withdrawing the request brings it back', async () => {
    const { token, userId, noteId } = await seed();
    const reqId = await restrict(userId);
    expect(await exported(token)).not.toContain(MARK);
    expect((await deps.notes.findByIdForUser(userId, noteId))!.rawText).toContain(MARK);
    expect(JSON.stringify(await deps.facts.listPromisesByUser(userId))).toContain(MARK);
    await deps.erasureRequests.setStatus(userId, reqId, 'withdrawn');
    const text = await exported(token);
    expect(text).toContain(MARK);
    expect(text).toContain('Kalid');
    expect(JSON.parse(text).restrictionNotice).toBeUndefined();
  });
});
