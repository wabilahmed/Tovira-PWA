import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';
import type { Transcriber } from '../ports/transcriber.js';

// [P57-4 · owner] New client → Record a voice note. POST /voice/draft transcribes the recording and suggests who it is
// about, and STORES NOTHING: no client, no note, no audio. The recording stays in the phone's outbox until the rep taps
// Create client; then the app creates the client and uploads the recording through the ordinary voice-note path
// (POST /clients/:id/notes/voice), which transcribes, blanks, screens and extracts it exactly as today. Tovira never
// creates the client without that tap. Same gates as a voice note: the 10-minute cap, the app's own recording only,
// the confirmation gate, and the AI allowance (transcription is metered).
let server: Server; let base: string; let deps: TestDeps;
let said = "Just met Sara Khan from Emaar, she wants a 3-bed in Arabian Ranches, budget around 3 million, I said I'd send options by Thursday.";
let fail = false;
const transcriber: Transcriber = { transcribe: async () => { if (fail) throw new Error('groq down'); return { text: said, quality: 'ok' }; } };
const sent: string[] = [];
const model: ModelClient = { complete: async (req) => { sent.push(JSON.stringify(req)); return { text: JSON.stringify({ summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }; } };
beforeEach(async () => {
  said = "Just met Sara Khan from Emaar, she wants a 3-bed in Arabian Ranches, budget around 3 million, I said I'd send options by Thursday.";
  fail = false;
  sent.length = 0;
  deps = buildInMemoryDeps({}, { modelClient: model, transcriber });
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 5, 6, 7, 8]);
async function rep(): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const draft = (token: string, body: Uint8Array = WEBM) => fetch(`${base}/voice/draft`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body });
const nothingStored = async (userId: string) => {
  expect(await deps.clients.listByUser(userId)).toEqual([]);
  expect(await deps.notes.listPendingByUser(userId)).toEqual([]);
};

describe('[P57-4] the voice draft: transcribe and suggest, store nothing', () => {
  it('a clear name: the transcript and the suggested name and company come back; nothing is created before the tap', async () => {
    const { token, userId } = await rep();
    const res = await draft(token);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ transcript: said, suggestion: { name: 'Sara Khan', company: 'Emaar', phone: null } });
    await nothingStored(userId);
    expect(sent).toEqual([]); // no model call: transcription only
  });
  it('no name heard: no suggested name (the app asks "Who is this client?")', async () => {
    said = 'Quick one, they want the revised quote by Friday.';
    const { token } = await rep();
    expect(((await (await draft(token)).json()) as { suggestion: { name: string | null } }).suggestion.name).toBeNull();
  });
  it('an Aadhaar read out is blanked in the transcript the rep sees', async () => {
    said = 'Met Ravi Kumar, his Aadhaar is 2345 6789 0124.';
    const { token } = await rep();
    const { transcript } = (await (await draft(token)).json()) as { transcript: string };
    expect(transcript).toBe('Met Ravi Kumar, his Aadhaar is [ID redacted].');
  });
  it('NEGATIVE: transcription unavailable → 503 with the recording still on the phone; nothing stored', async () => {
    fail = true;
    const { token, userId } = await rep();
    const res = await draft(token);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'transcription_unavailable', message: "Couldn't transcribe that just now. Your recording is kept on this phone. Try again." });
    await nothingStored(userId);
  });
  it('NEGATIVE: the voice-note gates: not signed in, not the app\'s recording, over the 10-minute cap', async () => {
    const { token } = await rep();
    expect((await fetch(`${base}/voice/draft`, { method: 'POST', body: WEBM })).status).toBe(401);
    expect((await draft(token, new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]))).status).toBe(415);
    const big = new Uint8Array(11_000_001); big.set([0x1a, 0x45, 0xdf, 0xa3]);
    const r = await draft(token, big);
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ error: 'too_long', message: 'This recording is over the 10-minute limit for a voice note.' });
  });
});

describe('[P57-4] after the tap: the ordinary voice-note path', () => {
  it('"hepatitis" in the voice note is withheld from the model; the stored transcript is the rep\'s words', async () => {
    said = 'Met Sara Khan from Emaar. Her husband has hepatitis, so they want a quiet ground floor. I said I would send options by Thursday.';
    const { token, userId } = await rep();
    const d = (await (await draft(token)).json()) as { suggestion: { name: string } };
    const c = (await (await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: d.suggestion.name, company: 'Emaar', checkDuplicate: true }) })).json()) as { id: string };
    expect((await fetch(`${base}/clients/${c.id}/notes/voice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body: WEBM })).status).toBe(201);
    await deps.runSweep();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).not.toContain('hepatitis');
    expect(sent.join('\n')).toContain('send options by Thursday');
    const [n] = await deps.notes.listByClient(userId, c.id);
    expect(n!.rawText).toBe(said);
  });
});
