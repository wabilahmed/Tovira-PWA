import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

// [P50-2 · owner] With exact-name folding, "Khalid" in a chat whose client is "Khalid Al Mansoori" no longer folds. Tovira
// never guesses: when an unfolded person shares a word with the client's name or an alias, Needs your answer asks "Is
// 'Khalid' in this chat the same person as Khalid Al Mansoori?". Same person folds them and keeps "Khalid" as a
// rep-confirmed alias; Different person keeps them apart and is never asked again; until answered they are their own
// entry, never merged. A restricted person is never shown in the card.
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const DAY = 86_400_000;
const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
type Q = { id: string; clientId: string; clientName: string; personName: string; quote: string | null; question: string };
async function rep(email = 'rep@example.com'): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const person = (name: string, span: string | null = null) => ({ name, role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: span, source_message_at: span ? '2026-07-13T09:01' : null });
async function seed(t: string, userId: string, clientName = 'Khalid Al Mansoori', people = [person('Khalid', 'Khalid: the driver will bring the keys'), person('Sara')]) {
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(t), body: JSON.stringify({ name: clientName }) })).json()) as { id: string }).id;
  const note = await deps.notes.create(userId, { clientId, source: 'paste', rawText: 'Khalid: the driver will bring the keys', audioKey: null, status: 'extracted' } as never);
  const extracted = { summary: 'x', promises: [], people, personal_facts: [{ subject: 'Khalid', fact: 'drives a white van', category: 'background', source_span: null, source_message_at: null }], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [], requirements: [] };
  await deps.notes.update(userId, note.id, { extracted: extracted as never });
  await deps.samePerson!.noteLookalikes(userId, clientId, note.id, extracted);
  return { clientId, noteId: note.id };
}
const list = async (t: string) => ((await (await fetch(`${base}/confirmations/same-person`, { headers: h(t) })).json()) as { questions: Q[] }).questions;
const answer = (t: string, id: string, a: string) => fetch(`${base}/confirmations/same-person/${id}`, { method: 'POST', headers: h(t), body: JSON.stringify({ answer: a }) });
const peopleOf = async (userId: string, noteId: string) => (((await deps.notes.findByIdForUser(userId, noteId))!.extracted as { people: Array<{ name: string }> }).people).map((p) => p.name);

describe('[P50-2] "Is \'Khalid\' the same person as Khalid Al Mansoori?"', () => {
  it('an unfolded person sharing a word with the client is asked about, with the receipt; one sharing nothing is not', async () => {
    const { token, userId } = await rep();
    const { clientId } = await seed(token, userId);
    const qs = await list(token);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ clientId, clientName: 'Khalid Al Mansoori', personName: 'Khalid', quote: 'Khalid: the driver will bring the keys', question: 'Is \'Khalid\' in this chat the same person as Khalid Al Mansoori?' });
  });

  it('NEGATIVE: unanswered, they stay their own entry, never merged', async () => {
    const { token, userId } = await rep();
    const { noteId } = await seed(token, userId);
    expect(await peopleOf(userId, noteId)).toEqual(['Khalid', 'Sara']);
  });

  it('Same person: folded into the client, "Khalid" kept as a rep-confirmed alias, and the card is gone', async () => {
    const { token, userId } = await rep();
    const { clientId, noteId } = await seed(token, userId);
    const [q] = await list(token);
    expect((await answer(token, q!.id, 'same')).status).toBe(200);
    expect(await peopleOf(userId, noteId)).toEqual(['Khalid Al Mansoori', 'Sara']);
    const facts = ((await deps.notes.findByIdForUser(userId, noteId))!.extracted as { personal_facts: Array<{ subject: string }> }).personal_facts;
    expect(facts[0]!.subject).toBe('Khalid Al Mansoori');
    expect(await deps.aliases!.listByClientWithKind(userId, clientId)).toEqual([{ alias: 'Khalid', kind: 'rep_confirmed' }]);
    expect(await list(token)).toEqual([]);
  });

  it('Different person: kept apart and never asked about that pair again', async () => {
    const { token, userId } = await rep();
    const { clientId, noteId } = await seed(token, userId);
    const [q] = await list(token);
    expect((await answer(token, q!.id, 'different')).status).toBe(200);
    expect(await peopleOf(userId, noteId)).toEqual(['Khalid', 'Sara']);
    // the next chat names him again: no new question
    await deps.samePerson!.noteLookalikes(userId, clientId, noteId, { people: [person('khalid')] });
    expect(await list(token)).toEqual([]);
    expect(await deps.aliases!.listByClientWithKind(userId, clientId)).toEqual([]);
  });

  it('a word shared with an alias asks too ("Hills Properties" and the client saved as "Ahmed Dubai Hills")', async () => {
    const { token, userId } = await rep();
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(token), body: JSON.stringify({ name: 'Ahmed Al Falasi' }) })).json()) as { id: string }).id;
    await deps.aliases!.add(userId, clientId, 'Ahmed Dubai Hills');
    await deps.samePerson!.noteLookalikes(userId, clientId, null, { people: [person('Hills Properties')] });
    expect((await list(token)).map((q) => q.question)).toEqual(['Is \'Hills Properties\' in this chat the same person as Ahmed Al Falasi?']);
  });

  it('NEGATIVE: the client under their exact name, a phone number, or someone sharing nothing is never asked about', async () => {
    const { token, userId } = await rep();
    await seed(token, userId, 'Khalid Al Mansoori', [person('Khalid Al Mansoori'), person('+971 50 123 4567'), person('Sara Lee')]);
    expect(await list(token)).toEqual([]);
  });

  it('NEGATIVE: a restricted person (or a restricted client) is never shown in the card; it returns when the request ends', async () => {
    const { token, userId } = await rep();
    await seed(token, userId);
    const req = await deps.erasureRequests.create(userId, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    const text = await (await fetch(`${base}/confirmations/same-person`, { headers: h(token) })).text();
    expect(text).not.toContain('Khalid');
    expect(text).not.toContain('driver will bring');
    await deps.erasureRequests.setStatus(userId, req.id, 'withdrawn');
    expect(await list(token)).toHaveLength(1);
  });

  it('NEGATIVE: a card whose receipt is the restricted person\'s own message is withheld, even when the name asked about is not theirs', async () => {
    const { token, userId } = await rep();
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(token), body: JSON.stringify({ name: 'Marina Estates' }) })).json()) as { id: string }).id;
    const note = await deps.notes.create(userId, { clientId, source: 'whatsapp_export', rawText: 'Khalid: Marina sends regards', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-07-13T09:01', sender: 'Khalid', body: 'Marina sends regards', media: false, role: 'client' }] } as never);
    await deps.samePerson!.noteLookalikes(userId, clientId, note.id, { people: [person('Marina', 'Marina sends regards')] });
    expect(await list(token)).toHaveLength(1);
    await deps.erasureRequests.create(userId, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect(await list(token)).toEqual([]);
  });

  it('NEGATIVE: another rep can\'t see or answer it; a bad answer is refused; an answered card can\'t be answered again', async () => {
    const a = await rep('a@example.com');
    const b = await rep('b@example.com');
    await seed(a.token, a.userId);
    const [q] = await list(a.token);
    expect(await list(b.token)).toEqual([]);
    expect((await answer(b.token, q!.id, 'same')).status).toBe(404);
    expect((await answer(a.token, q!.id, 'maybe')).status).toBe(400);
    expect((await answer(a.token, q!.id, 'different')).status).toBe(200);
    expect((await answer(a.token, q!.id, 'same')).status).toBe(404);
  });
});

describe('[P50-2] the question comes from extraction itself', () => {
  it('an extracted "Khalid" in Khalid Al Mansoori\'s chat stays his own entry and becomes a card', async () => {
    const out = JSON.stringify({ summary: 'x', promises: [], key_dates: [], personal_facts: [], concerns: [], next_steps: [], meeting: null, requirements: [], people: [person('Khalid', 'Khalid: the driver will bring the keys'), person('Khalid Al Mansoori')] });
    const d = buildInMemoryDeps({}, { modelClient: { complete: async () => ({ text: out }) } });
    const u = (await d.auth.signup('x@example.com', 'password123')).user.id;
    const c = await d.clients.create(u, 'Khalid Al Mansoori');
    const n = await d.notes.create(u, { clientId: c.id, source: 'paste', rawText: 'Khalid: the driver will bring the keys', audioKey: null, status: 'pending_extraction' } as never);
    await d.extraction.extractNote(u, n.id, '2026-07-13');
    const stored = ((await d.notes.findByIdForUser(u, n.id))!.extracted as { people: Array<{ name: string }> }).people.map((p) => p.name);
    expect(stored).toEqual(['Khalid', 'Khalid Al Mansoori']); // not merged
    expect((await d.samePerson.list(u)).map((q) => q.personName)).toEqual(['Khalid']);
  });
});
