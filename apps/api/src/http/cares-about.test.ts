import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P69 · owner] "What they care about": the client page (GET /clients/:id/overview) carries what the client said
 * about themselves, read from the stored record: personal details first (with the message they came from), then
 * open asks (with the client's own words), then worries from the latest chats. Never a health fact, never a
 * restricted person's detail, never the same thing twice.
 */
let server: Server;
let base: string;
let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const DAY = 86_400_000;

async function seed(): Promise<{ token: string; userId: string; clientId: string; noteId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) });
  const { token, user } = (await res.json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Layla Haddad' }) })).json()) as { id: string }).id;
  const note = await deps.notes.create(user.id, {
    clientId, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: 'Layla Haddad: Honestly I love the beach, I go every morning before work',
    messages: [{ sentAt: '2026-11-10T18:03', sender: 'Layla Haddad', body: 'Honestly I love the beach, I go every morning before work', media: false, role: 'client' }],
  });
  await deps.notes.update(user.id, note.id, {
    extracted: {
      summary: 'Layla is looking for a 2-bed.', promises: [], people: [], key_dates: [], next_steps: [], meeting: null,
      personal_facts: [
        { subject: 'Layla', fact: 'Loves the beach, goes every morning before work', category: 'hobby', source_span: 'I love the beach, I go every morning before work', source_message_at: '2026-11-10T18:03' },
        { subject: 'Layla', fact: 'loves the beach, goes every morning before work', category: 'hobby', source_span: 'I love the beach', source_message_at: '2026-11-10T18:03' },
        { subject: 'Layla', fact: 'Has a knee injury', category: 'health', source_span: 'my knee', source_message_at: '2026-11-10T18:04' },
        { subject: 'Khalid', fact: 'Collects watches', category: 'background', source_span: 'Khalid collects watches', source_message_at: '2026-11-10T18:05' },
      ],
      concerns: ['Service charges on the last place were too high'],
    } as unknown as never,
  });
  await deps.requirements.saveForNote(user.id, note.id, clientId, [{ text: 'A 2-bed near the beach', requirementRaw: '2 bed ideally', statedOn: '2026-11-10', confidence: 'high', embedding: null }]);
  return { token, userId: user.id, clientId, noteId: note.id };
}

async function cares(token: string, clientId: string) {
  const o = (await (await fetch(`${base}/clients/${clientId}/overview`, { headers: auth(token) })).json()) as { caresAbout: Array<Record<string, unknown>> };
  return o.caresAbout;
}

describe('[P69] What they care about, on the client page', () => {
  it('details first with their source message, then asks in the client\'s words, then worries', async () => {
    const { token, clientId, noteId } = await seed();
    expect(await cares(token, clientId)).toEqual([
      { kind: 'detail', text: 'Loves the beach, goes every morning before work', subject: null, noteId, quote: 'I love the beach, I go every morning before work', at: '2026-11-10T18:03' },
      { kind: 'detail', text: 'Collects watches', subject: 'Khalid', noteId, quote: 'Khalid collects watches', at: '2026-11-10T18:05' },
      { kind: 'ask', text: 'A 2-bed near the beach', subject: null, noteId, quote: '2 bed ideally', at: '2026-11-10' },
      { kind: 'worry', text: 'Service charges on the last place were too high', subject: null, noteId, quote: null, at: null },
    ]);
  });

  it('a person under an erasure review is withheld, and the client under review hides the whole list', async () => {
    const { token, userId, clientId } = await seed();
    const now = Date.now();
    await deps.erasureRequests.create(userId, { requesterNames: ['Khalid'], requestedAt: now, windowEndsAt: now + 10 * DAY });
    expect((await cares(token, clientId)).map((c) => c.text)).not.toContain('Collects watches');
    await deps.erasureRequests.create(userId, { requesterNames: ['Layla Haddad'], requestedAt: now, windowEndsAt: now + 10 * DAY });
    expect((await cares(token, clientId)).filter((c) => c.kind === 'detail')).toEqual([]);
  });
});

describe('[P69] What they care about, first in the pre-meeting brief', () => {
  it('the brief carries the same list, with sources, before anything else', async () => {
    const { token, clientId, noteId } = await seed();
    const brief = (await (await fetch(`${base}/clients/${clientId}/brief`, { headers: auth(token) })).json()) as { caresAbout: Array<Record<string, unknown>> };
    expect(brief.caresAbout.map((c) => [c.kind, c.text, c.quote])).toEqual([
      ['detail', 'Loves the beach, goes every morning before work', 'I love the beach, I go every morning before work'],
      ['detail', 'Collects watches', 'Khalid collects watches'],
      ['ask', 'A 2-bed near the beach', '2 bed ideally'],
      ['worry', 'Service charges on the last place were too high', null],
    ]);
    expect(brief.caresAbout[0]!.noteId).toBe(noteId);
  });

  it('a restricted person is withheld from the brief too', async () => {
    const { token, userId, clientId } = await seed();
    const now = Date.now();
    await deps.erasureRequests.create(userId, { requesterNames: ['Khalid'], requestedAt: now, windowEndsAt: now + 10 * DAY });
    const brief = (await (await fetch(`${base}/clients/${clientId}/brief`, { headers: auth(token) })).json()) as { caresAbout: Array<{ text: string }> };
    expect(brief.caresAbout.map((c) => c.text)).not.toContain('Collects watches');
  });
});

describe('[P69] Today: under each client, what they care about', () => {
  it('a going-quiet client on Today carries "cares" from the current record; a restricted detail is not used', async () => {
    const { token, userId, clientId } = await seed();
    await deps.clients.setLastTouched(userId, clientId, Date.now() - 45 * DAY);
    const today = async () => ((await (await fetch(`${base}/today`, { headers: auth(token) })).json()) as { actions: Array<{ clientId: string | null; cares?: string }> }).actions;
    const card = (await today()).find((a) => a.clientId === clientId);
    expect(card?.cares).toBe('Loves the beach, goes every morning before work');
    const now = Date.now();
    await deps.erasureRequests.create(userId, { requesterNames: ['Layla Haddad', 'Layla'], requestedAt: now, windowEndsAt: now + 10 * DAY });
    const after = (await today()).find((a) => a.clientId === clientId);
    expect(after?.cares ?? '').not.toMatch(/beach, goes every morning/);
  });
});

describe('[P69] their dates are part of what they care about', () => {
  it('an upcoming date, as they said it, with its source; a past one drops off', async () => {
    const { token, userId, clientId, noteId } = await seed();
    await deps.facts.saveExtraction(userId, { noteId, clientId, promises: [], keyDates: [
      { description: 'Board meeting', date: '2099-03-14', date_raw: 'the 14th', type: 'deadline', source_span: 'board meets on the 14th', source_message_at: '2026-11-10T18:06' },
      { description: 'Anniversary', date: null, date_raw: 'in May', type: 'anniversary', source_span: 'our anniversary is in May', source_message_at: '2026-11-10T18:07' },
      { description: 'Old launch', date: '2020-01-01', date_raw: 'January', type: 'launch', source_span: 'launch in January', source_message_at: null },
    ] as never });
    const dates = (await cares(token, clientId)).filter((c) => c.kind === 'date').map((c) => [c.text, c.quote]);
    expect(dates).toEqual([['Board meeting · the 14th', 'board meets on the 14th'], ['Anniversary · in May', 'our anniversary is in May']]);
  });
});
