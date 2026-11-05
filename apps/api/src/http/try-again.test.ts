import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';
import type { Transcriber } from '../ports/transcriber.js';

// [P65-2 · owner] When Tovira couldn't read something on our side, Try again runs it again from what is already stored
// (the typed text, the chat, the recording), so the rep never sends it again, and it never duplicates what was saved.
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const TEXT = 'I will send the floor plan by Friday.';
const GOOD = JSON.stringify({ summary: 'x', promises: [{ text: 'send the floor plan', owner: 'rep', due_date: null, due_raw: 'by Friday', confidence: 'high', source_span: 'I will send the floor plan by Friday', source_message_at: null }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null });
function switchable(): { model: ModelClient; set: (ok: boolean) => void } {
  let ok = false;
  return { set: (v) => { ok = v; }, model: { complete: async () => ({ text: ok ? GOOD : 'not json at all' }) } as ModelClient };
}
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(opts: { modelClient?: ModelClient; transcriber?: Transcriber } = {}): Promise<{ url: string; deps: TestDeps; token: string; clientId: string; userId: string }> {
  const deps = buildInMemoryDeps({}, opts);
  server = createApiServer(deps);
  const url = await listenForTest(server!);
  const s = (await (await fetch(`${url}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `rep${Math.random()}@example.com`, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${url}/clients`, { method: 'POST', headers: H(s.token), body: JSON.stringify({ name: 'Anjali Mehra' }) })).json()) as { id: string }).id;
  return { url, deps, token: s.token, clientId, userId: s.user.id };
}
type Item = { noteId: string; state: string; failure?: { reason: string; canRetry: boolean }; found?: { promises: number } };
const items = async (url: string, token: string) => ((await (await fetch(`${url}/processing`, { headers: H(token) })).json()) as { items: Item[] }).items;
const tryAgain = (url: string, token: string, noteId: string) => fetch(`${url}/notes/${noteId}/extract`, { method: 'POST', headers: H(token) });

describe('[P65-2] Try again', () => {
  it('a typed note that failed on our side: Try again reads it again from the stored text, and it is done', async () => {
    const m = switchable();
    const { url, deps, token, clientId } = await start({ modelClient: m.model });
    await fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: TEXT }) });
    await deps.runSweep(6);
    const [failed] = await items(url, token);
    expect(failed).toMatchObject({ state: 'failed', failure: { reason: 'ours', canRetry: true } });
    m.set(true);
    expect((await tryAgain(url, token, failed!.noteId)).status).toBe(202);
    expect((await items(url, token))[0]!.state).toBe('working'); // no new note, nothing sent again
    await deps.runSweep();
    expect((await items(url, token))[0]).toMatchObject({ noteId: failed!.noteId, state: 'done', found: { promises: 1 } });
  });
  it('NEGATIVE: Try again does not duplicate: tapped twice, then run, there is one note and one set of promises', async () => {
    const m = switchable();
    const { url, deps, token, clientId, userId } = await start({ modelClient: m.model });
    await fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: TEXT }) });
    await deps.runSweep(6);
    const [failed] = await items(url, token);
    m.set(true);
    await tryAgain(url, token, failed!.noteId);
    await tryAgain(url, token, failed!.noteId);
    await deps.runSweep();
    await tryAgain(url, token, failed!.noteId); // and once more after it is done
    await deps.runSweep();
    expect(await deps.notes.listByClient(userId, clientId)).toHaveLength(1);
    expect(await deps.facts.listPromisesByNote(userId, failed!.noteId)).toHaveLength(1);
  });
  it('a voice note that failed before it had a transcript: Try again transcribes the stored recording again', async () => {
    let speak = false;
    const transcriber: Transcriber = { transcribe: async () => { if (!speak) throw new Error('groq timeout'); return { text: TEXT }; } } as Transcriber;
    const { url, deps, token, clientId, userId } = await start({ transcriber });
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(4000).fill(1)]);
    await fetch(`${url}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body: audio });
    await deps.runSweep(8);
    const [failed] = await items(url, token);
    expect(failed).toMatchObject({ state: 'failed', failure: { reason: 'ours', canRetry: true } });
    speak = true;
    expect((await tryAgain(url, token, failed!.noteId)).status).toBe(202);
    const n = await deps.notes.findByIdForUser(userId, failed!.noteId);
    expect(n!.status).toBe('pending_transcription');
    await deps.runSweep(3);
    expect((await items(url, token))[0]!.state).toBe('done');
  });
});
