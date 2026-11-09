import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { Transcriber } from '../ports/transcriber.js';
import { DraftTranscriptCache, DRAFT_TRANSCRIPT_TTL_MS } from '../services/transcription/draft-transcripts.js';

/**
 * [P67-2 · owner] A voice note is transcribed only once.
 *  - The app asks to transcribe the moment it uploads, and the sweep picks up the same note: only one of them calls the
 *    transcriber (a claim on the note), and a finished note is never transcribed again.
 *  - New client by voice: the recording is transcribed for the confirm step; when the SAME recording is uploaded as the
 *    client's first voice note, that transcript is used (no second call). A different recording still transcribes.
 */
let server: Server; let base: string; let deps: TestDeps;
let calls = 0;
let fail = false;
let gate: Promise<void> | null = null;
const said = 'Met Sara Khan from Emaar, she wants options by Thursday.';
const transcriber: Transcriber = { transcribe: async () => { calls += 1; if (gate) await gate; if (fail) throw new Error('groq down'); return { text: said, quality: 'ok' }; } };
beforeEach(async () => {
  calls = 0; fail = false; gate = null;
  deps = buildInMemoryDeps({}, { transcriber });
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 5, 6, 7, 8]);
const OTHER = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9, 9]);
async function rep(): Promise<string> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string };
  return b.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
async function client(token: string, name = 'Sara Khan'): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()) as { id: string }).id;
}
async function voice(token: string, cid: string, audio: Uint8Array = WEBM): Promise<string> {
  const res = await fetch(`${base}/clients/${cid}/notes/voice`, { method: 'POST', headers: { ...auth(token), 'content-type': 'audio/webm' }, body: audio });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
const transcribe = (token: string, id: string) => fetch(`${base}/notes/${id}/transcribe`, { method: 'POST', headers: auth(token) });
const draft = (token: string, audio: Uint8Array = WEBM) => fetch(`${base}/voice/draft`, { method: 'POST', headers: { ...auth(token), 'content-type': 'audio/webm' }, body: audio });
async function noteOf(token: string, cid: string): Promise<{ status: string; rawText: string | null }> {
  const { notes } = (await (await fetch(`${base}/clients/${cid}/notes`, { headers: auth(token) })).json()) as { notes: Array<{ status: string; rawText: string | null }> };
  return notes[0]!;
}

describe('[P67-2] a voice note is transcribed only once', () => {
  it('the app and the sweep at the same time: one transcription', async () => {
    const token = await rep();
    const cid = await client(token);
    const id = await voice(token, cid);
    let open!: () => void;
    gate = new Promise<void>((r) => { open = r; });
    const inline = transcribe(token, id); // the app's immediate request, held inside the transcriber
    await new Promise((r) => setTimeout(r, 20));
    await deps.runSweep(1); // the sweep reaches the same note meanwhile
    open();
    expect((await inline).status).toBe(200);
    expect(calls).toBe(1);
    expect((await noteOf(token, cid)).status).not.toBe('pending_transcription');
  });

  it('a finished note is not transcribed again', async () => {
    const token = await rep();
    const cid = await client(token);
    const id = await voice(token, cid);
    await transcribe(token, id);
    await transcribe(token, id);
    await deps.runSweep(1);
    expect(calls).toBe(1);
  });

  it('a failed attempt gives the claim back: the next one transcribes at once', async () => {
    const token = await rep();
    const cid = await client(token);
    const id = await voice(token, cid);
    fail = true;
    await transcribe(token, id);
    fail = false;
    await transcribe(token, id);
    expect(calls).toBe(2);
    expect((await noteOf(token, cid)).rawText).toBe(said);
  });

  it('new client by voice: the confirm-step transcript is reused for the same recording', async () => {
    const token = await rep();
    expect((await draft(token)).status).toBe(200);
    expect(calls).toBe(1);
    const cid = await client(token); // the rep tapped Create client
    const id = await voice(token, cid); // the same recording, from the phone's outbox
    await transcribe(token, id);
    await deps.runSweep(1);
    expect(calls).toBe(1);
    const n = await noteOf(token, cid);
    expect(n.rawText).toBe(said);
    expect(n.status).not.toBe('pending_transcription');
  });

  it('a different recording is transcribed as usual', async () => {
    const token = await rep();
    await draft(token);
    const cid = await client(token);
    const id = await voice(token, cid, OTHER);
    await transcribe(token, id);
    expect(calls).toBe(2);
  });
});

describe('[P67-2] the draft transcript cache', () => {
  it('is per rep and per exact recording, taken once, and expires after 30 minutes', () => {
    let now = 1_000_000;
    const cache = new DraftTranscriptCache(() => now);
    cache.put('u1', WEBM, { text: 'hello', quality: 'ok' });
    expect(cache.take('u2', WEBM)).toBeNull();
    expect(cache.take('u1', OTHER)).toBeNull();
    expect(cache.take('u1', WEBM)).toEqual({ text: 'hello', quality: 'ok' });
    expect(cache.take('u1', WEBM)).toBeNull();
    cache.put('u1', WEBM, { text: 'hello' });
    now += DRAFT_TRANSCRIPT_TTL_MS + 1;
    expect(cache.take('u1', WEBM)).toBeNull();
  });
});
