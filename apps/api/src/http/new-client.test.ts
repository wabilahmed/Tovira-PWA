import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';

// [P57-3 · owner] A rep adds a client they just met, or only talk to by phone, with no chat: a name (required), and
// optionally phone, company, industry (the sign-up form's list) and role. Typed notes then go through the ordinary
// pasted-note path (POST /clients/:id/notes/paste): Tier-1 blanked before storage, the precise list before the model,
// receipts are the rep's own sentences, dates from the capture moment. A client with the same name or the same phone
// is a question ("You already have Sara Khan. Add this to Sara Khan instead?"), never a silent merge. The erasure guard
// covers it as it covers every client (P49): a restricted person's client comes back name-locked, and a typed note
// about them is withheld from the model.
let server: Server; let base: string; let deps: TestDeps;
const sent: string[] = [];
let reply: unknown = { summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null };
const model: ModelClient = { complete: async (req) => { sent.push(JSON.stringify(req)); return { text: JSON.stringify(reply) }; } };
beforeEach(async () => {
  sent.length = 0;
  reply = { summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null };
  deps = buildInMemoryDeps({}, { modelClient: model });
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const create = (t: string, body: unknown) => fetch(`${base}/clients`, { method: 'POST', headers: h(t), body: JSON.stringify(body) });

describe('[P57-3] creating a client by typing', () => {
  it('with only a name: created, and no AI call is made', async () => {
    const { token, userId } = await rep();
    const res = await create(token, { name: 'Sara Khan', checkDuplicate: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Sara Khan', company: null, industry: null, phone: null, title: null });
    await deps.runSweep();
    expect(sent).toEqual([]);
    expect(await deps.notes.listByClient(userId, ((await deps.clients.listByUser(userId))[0]!).id)).toEqual([]);
  });

  it('phone, company, industry and role are stored and returned', async () => {
    const { token } = await rep();
    const res = await create(token, { name: 'Sara Khan', phone: '+971 50 123 4567', company: ' Emaar ', industry: 'property', title: 'Head of leasing' });
    expect(res.status).toBe(201);
    const c = (await res.json()) as { id: string };
    expect(c).toMatchObject({ phone: '+971501234567', company: 'Emaar', industry: 'property', title: 'Head of leasing' });
    expect(await (await fetch(`${base}/clients/${c.id}`, { headers: h(token) })).json()).toMatchObject({ company: 'Emaar', industry: 'property' });
  });

  it('NEGATIVE: an industry outside the sign-up list, or a name over 80 characters, is refused and nothing is created', async () => {
    const { token, userId } = await rep();
    const bad = await create(token, { name: 'Sara Khan', industry: 'astrology' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'validation', message: 'Choose an industry from the list.' });
    const long = await create(token, { name: 'k'.repeat(81) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'validation', message: 'Keep the name to 80 characters or fewer.' });
    expect(await deps.clients.listByUser(userId)).toEqual([]);
  });

  it('with a note: the typed note is extracted through the pasted-note path; receipts are the typed sentences; "Thursday" from the capture day', async () => {
    const { token, userId } = await rep();
    const typed = 'She wants a 3-bed in Arabian Ranches, budget around 3 million. I said I\'d send options by Thursday.';
    reply = { summary: 'x', promises: [{ text: 'Send options', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high', source_span: "I said I'd send options by Thursday.", source_message_at: null }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null };
    const c = (await (await create(token, { name: 'Sara Khan', checkDuplicate: true })).json()) as { id: string };
    const note = await fetch(`${base}/clients/${c.id}/notes/paste`, { method: 'POST', headers: h(token), body: JSON.stringify({ text: typed }) });
    expect(note.status).toBe(201);
    await deps.runSweep();
    expect(sent.length).toBeGreaterThan(0);
    const [p] = await deps.facts.listPromisesByUser(userId);
    expect(p).toMatchObject({ text: 'Send options' });
    expect(p!.sourceSpan ?? (p as unknown as { source_span?: string }).source_span).toBe("I said I'd send options by Thursday.");
    expect(p!.dueDate).not.toBeNull();
    expect(new Date(`${p!.dueDate}T00:00:00Z`).getUTCDay()).toBe(4); // a Thursday
  });

  it('an Aadhaar in a typed note is blanked before storage and never reaches the model', async () => {
    const { token, userId } = await rep();
    const c = (await (await create(token, { name: 'Ravi Kumar' })).json()) as { id: string };
    await fetch(`${base}/clients/${c.id}/notes/paste`, { method: 'POST', headers: h(token), body: JSON.stringify({ text: 'Candidate Aadhaar 2345 6789 0124, joining Monday.' }) });
    await deps.runSweep();
    const [n] = await deps.notes.listByClient(userId, c.id);
    expect(n!.rawText).toBe('Candidate Aadhaar [ID redacted], joining Monday.');
    expect(sent.join('\n')).not.toContain('2345 6789 0124');
  });
});

describe('[P57-3] duplicates are a question, never a merge', () => {
  it('the same name (any case or spacing): 409 naming the existing client; nothing created until the rep chooses Create new', async () => {
    const { token, userId } = await rep();
    const first = (await (await create(token, { name: 'Sara Khan' })).json()) as { id: string };
    const res = await create(token, { name: '  sara   KHAN ', checkDuplicate: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_client', message: 'You already have Sara Khan. Add this to Sara Khan instead?', client: { id: first.id, name: 'Sara Khan' }, match: 'name' });
    expect(await deps.clients.listByUser(userId)).toHaveLength(1);
    expect((await create(token, { name: 'sara khan', checkDuplicate: true, confirmDuplicate: true })).status).toBe(201);
    expect(await deps.clients.listByUser(userId)).toHaveLength(2); // two separate clients, never merged
  });

  it('the same phone under another name: 409 naming that client', async () => {
    const { token } = await rep();
    const first = (await (await create(token, { name: 'Sara Khan', phone: '+971 50 123 4567' })).json()) as { id: string };
    const res = await create(token, { name: 'S. Khan (Emaar)', phone: '+971501234567', checkDuplicate: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'duplicate_client', client: { id: first.id, name: 'Sara Khan' }, match: 'phone', message: 'You already have Sara Khan. Add this to Sara Khan instead?' });
  });

  it('NEGATIVE: a different name and phone is not a duplicate; a shared first name alone is not either', async () => {
    const { token } = await rep();
    await create(token, { name: 'Sara Khan', phone: '+971 50 123 4567' });
    expect((await create(token, { name: 'Sara Ahmed', phone: '+971 55 765 4321', checkDuplicate: true })).status).toBe(201);
  });

  it('callers that do not ask for the check (onboarding, meetings, the shared-chat picker) behave as before', async () => {
    const { token } = await rep();
    await create(token, { name: 'Sara Khan' });
    expect((await create(token, { name: 'Sara Khan' })).status).toBe(201);
  });
});

describe('[P57-3] the erasure guard', () => {
  // The restriction's existing "about vs mention" rule (P47) applies unchanged: their own lines are withheld; a note in the
  // rep's own words that only mentions them is kept (an open question for the owner, not decided here).
  it('NEGATIVE: a client who is a restricted person comes back name-locked, and their own lines in a typed note never reach the model', async () => {
    const { token, userId } = await rep();
    await deps.erasureRequests.create(userId, { requesterNames: ['Sara Khan'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * 86_400_000 });
    const res = await create(token, { name: 'Sara Khan', checkDuplicate: true });
    expect(res.status).toBe(201);
    const c = (await res.json()) as { id: string; nameLocked?: boolean };
    expect(c.nameLocked).toBe(true);
    await fetch(`${base}/clients/${c.id}/notes/paste`, { method: 'POST', headers: h(token), body: JSON.stringify({ text: 'Called today.\nSara Khan: send me the villa brochure by Friday' }) });
    await deps.runSweep();
    expect(sent.join('\n')).not.toContain('villa brochure');
    expect((await create(token, { name: 'Omar Haddad' })).json()).resolves.not.toHaveProperty('nameLocked');
  });
});
