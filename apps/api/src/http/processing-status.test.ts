import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import { StubModelClient } from '../adapters/model/stub.js';
import type { ModelClient } from '../ports/model.js';

// [P65-1 · owner] After the rep imports a chat, types a note or records one, the server says what Tovira is doing with it,
// for every client, so the page that sent it doesn't matter: GET /processing. The moment it is submitted it is there
// (working, with the real stage only); when it is done, what was found, counted from what was saved; when it fails, the
// reason. Leaving and coming back reads the same answer.
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const TEXT = 'Met Anjali at the site. I will send the floor plan by Friday. She wants a 3BR in Mirdif, budget AED 3.4M. Her husband Ravi decides.';
const FOUND = JSON.stringify({
  summary: 'Site visit.',
  promises: [{ text: 'send the floor plan', owner: 'rep', due_date: null, due_raw: 'by Friday', confidence: 'high', source_span: 'I will send the floor plan by Friday', source_message_at: null }],
  people: [{ name: 'Ravi', role: 'husband', reports_to: null, decision_role: 'decision_maker', notes: null }],
  personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
  requirements: [{ text: '3BR in Mirdif, budget AED 3.4M', requirement_raw: 'She wants a 3BR in Mirdif, budget AED 3.4M', stated_on: null, confidence: 'high' }],
});

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(model?: ModelClient): Promise<{ url: string; deps: TestDeps; token: string; clientId: string; userId: string }> {
  const deps = buildInMemoryDeps({}, model ? { modelClient: model } : {});
  server = createApiServer(deps);
  const url = await listenForTest(server!);
  const s = (await (await fetch(`${url}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `rep${Math.random()}@example.com`, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${url}/clients`, { method: 'POST', headers: H(s.token), body: JSON.stringify({ name: 'Anjali Mehra' }) })).json()) as { id: string }).id;
  return { url, deps, token: s.token, clientId, userId: s.user.id };
}
type Item = { noteId: string; clientId: string; clientName: string; kind: string; state: string; stage?: string; etaMinutes?: number; messageCount?: number; hold?: string; found?: Record<string, number>; failure?: { reason: string; canRetry: boolean } };
const status = async (url: string, token: string) => (await (await fetch(`${url}/processing`, { headers: H(token) })).json()) as { items: Item[]; working: number };
const paste = (url: string, token: string, clientId: string, text = TEXT) => fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text }) });
const CHAT = ['5/11/2026, 09:00 - Anjali Mehra: Hi, can you send the floor plan?', '5/11/2026, 09:05 - Me: Yes, I will send it by Friday.', '5/11/2026, 09:06 - Anjali Mehra: Thanks'].join('\n');

describe('[P65-1] the status appears the moment it is submitted, for every path', () => {
  it('a typed note: working, waiting to start, about a minute, on its client', async () => {
    const { url, token, clientId } = await start();
    expect((await paste(url, token, clientId)).status).toBe(201);
    const s = await status(url, token);
    expect(s.working).toBe(1);
    expect(s.items[0]).toMatchObject({ clientId, clientName: 'Anjali Mehra', kind: 'typed', state: 'working', stage: 'waiting', etaMinutes: 1 });
  });
  it('a voice note: working, transcribing, about two minutes', async () => {
    const { url, token, clientId } = await start();
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(4000).fill(1)]);
    const r = await fetch(`${url}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body: audio });
    expect(r.status).toBe(201);
    expect((await status(url, token)).items[0]).toMatchObject({ kind: 'voice', state: 'working', stage: 'transcribing', etaMinutes: 2 });
  });
  it('a chat import: working, with its message count', async () => {
    const { url, token, clientId } = await start();
    const r = await fetch(`${url}/clients/${clientId}/notes/import`, { method: 'POST', headers: H(token), body: JSON.stringify({ content: CHAT, consent: true, firstImportAck: true }) });
    expect(r.status).toBe(202);
    expect((await status(url, token)).items[0]).toMatchObject({ kind: 'chat', state: 'working', messageCount: 3 });
  });
});

describe('[P65-1] done: what was found, from what was saved', () => {
  it('the counts match the saved promises, dates, requirements and people for that note; leaving and coming back reads the same', async () => {
    const { url, deps, token, clientId, userId } = await start(new StubModelClient(FOUND));
    await paste(url, token, clientId);
    await deps.runSweep();
    const s = await status(url, token);
    expect(s.working).toBe(0);
    const item = s.items[0]!;
    expect(item.state).toBe('done');
    const saved = {
      promises: (await deps.facts.listPromisesByNote(userId, item.noteId)).length,
      dates: (await deps.facts.listKeyDatesByNote(userId, item.noteId)).length + ((await deps.meetings.findByNoteId(userId, item.noteId)) ? 1 : 0),
      requirements: (await deps.requirements.listByClient(userId, clientId)).filter((r) => r.noteId === item.noteId).length,
    };
    expect(saved.promises).toBeGreaterThan(0); // the probe is real
    expect(item.found).toMatchObject(saved);
    expect(item.found!.people).toBe(1);
    expect(await status(url, token)).toEqual(s); // the same answer, whoever asks and whenever
  });
  it('NEGATIVE: nothing found is done with every count at zero, never "still working"', async () => {
    const { url, deps, token, clientId } = await start(); // the stub finds nothing
    await paste(url, token, clientId, 'Called, no answer.');
    await deps.runSweep();
    const item = (await status(url, token)).items[0]!;
    expect(item.state).toBe('done');
    expect(item.found).toEqual({ promises: 0, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 });
  });
});

describe('[P65-1] failures and holds, with the reason', () => {
  it('a failure on our side: failed, reason ours, Try again possible', async () => {
    const broken: ModelClient = { complete: async () => ({ text: 'not json at all', usage: { inputTokens: 0, outputTokens: 0 } }) };
    const { url, deps, token, clientId } = await start(broken);
    await paste(url, token, clientId);
    await deps.runSweep(6);
    expect((await status(url, token)).items[0]).toMatchObject({ state: 'failed', failure: { reason: 'ours', canRetry: true } });
  });
  it('the monthly allowance used up: held (saved), reason allowance, and not counted as working', async () => {
    const { url, deps, token, clientId, userId } = await start();
    await deps.exhaustAllowance(userId);
    await paste(url, token, clientId);
    const s = await status(url, token);
    expect(s.items[0]).toMatchObject({ state: 'held', hold: 'allowance' });
    expect(s.working).toBe(0); // the app stops polling: nothing will change until a top-up
  });
});

describe('[P65-1] scope', () => {
  it('NEGATIVE: without a session it is refused', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/processing`)).status).toBe(401);
  });
  it('NEGATIVE: another rep never sees this rep\'s items', async () => {
    const { url, token, clientId } = await start();
    await paste(url, token, clientId);
    const other = (await (await fetch(`${url}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'other@example.com', password: 'password123', consent: true }) })).json()) as { token: string };
    expect((await status(url, other.token)).items).toEqual([]);
  });
  it('a finished item drops off after a day; one still working never does', async () => {
    const { url, deps, token, clientId } = await start();
    await paste(url, token, clientId, 'Called, no answer.');
    await deps.runSweep();
    expect((await status(url, token)).items).toHaveLength(1);
    deps.processingClock.offsetMs = 25 * 3_600_000;
    expect((await status(url, token)).items).toEqual([]);
    await paste(url, token, clientId); // still working: always shown
    expect((await status(url, token)).items).toHaveLength(1);
  });
});
