import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';

// [P57-2 · owner] A typed or voice note's relative dates resolve from the moment it was CAPTURED, in the rep's timezone,
// not from the day the extraction happened to run (it used to be the sweep's UTC date). A voice note recorded offline
// keeps its recording time: the app sends it, the server keeps it when it is sane (never in the future, at most 30 days
// old) and uses the upload time otherwise. The no-guess rule is unchanged: "sometime next month" is a date to confirm.
let server: Server; let base: string; let deps: TestDeps;
let promise = { text: 'Send the options', due_raw: 'Thursday' };
const model: ModelClient = { complete: async () => ({ text: JSON.stringify({ summary: 'x', promises: [{ text: promise.text, owner: 'rep', due_date: null, due_raw: promise.due_raw, confidence: 'high', source_span: `I said I'd send options by ${promise.due_raw}`, source_message_at: null }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }) };
beforeEach(async () => {
  promise = { text: 'Send the options', due_raw: 'Thursday' };
  deps = buildInMemoryDeps({}, { modelClient: model });
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(timezone = 'Asia/Dubai'): Promise<{ token: string; userId: string; clientId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123', timezone }) })).json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ name: 'Sara Khan' }) })).json()) as { id: string }).id;
  return { token: b.token, userId: b.user.id, clientId };
}
const TEXT = "Met Sara. I said I'd send options by Thursday.";
async function dueOf(userId: string) {
  const [p] = await deps.facts.listPromisesByUser(userId);
  return { dueDate: p!.dueDate, dateStatus: p!.dateStatus ?? null };
}

describe('[P57-2] relative dates resolve from the capture moment', () => {
  it('"Thursday" in a note captured on Monday 26 Oct resolves to 29 Oct, even when the extraction runs weeks later', async () => {
    const { userId, clientId } = await rep();
    const n = await deps.notes.create(userId, { clientId, source: 'paste', rawText: TEXT, audioKey: null, status: 'pending_extraction', capturedAt: Date.parse('2026-10-26T06:00:00Z') });
    await deps.extraction.extractNote(userId, n.id, '2026-11-10');
    expect(await dueOf(userId)).toMatchObject({ dueDate: '2026-10-29' });
  });
  it('the capture day is the rep\'s local day: 20:00 UTC on Wednesday is already Thursday in India, so "Thursday" is the next one', async () => {
    const { userId, clientId } = await rep('Asia/Kolkata');
    const n = await deps.notes.create(userId, { clientId, source: 'voice', rawText: TEXT, audioKey: null, status: 'pending_extraction', capturedAt: Date.parse('2026-10-28T20:00:00Z') });
    await deps.extraction.extractNote(userId, n.id, '2026-10-28');
    expect(await dueOf(userId)).toMatchObject({ dueDate: '2026-11-05' });
  });
  it('NEGATIVE: "sometime next month" is never guessed: no date, a date to confirm', async () => {
    promise = { text: 'Send the options', due_raw: 'sometime next month' };
    const { userId, clientId } = await rep();
    const n = await deps.notes.create(userId, { clientId, source: 'paste', rawText: "I'll send options sometime next month", audioKey: null, status: 'pending_extraction', capturedAt: Date.parse('2026-10-26T06:00:00Z') });
    await deps.extraction.extractNote(userId, n.id, '2026-10-26');
    expect(await dueOf(userId)).toEqual({ dueDate: null, dateStatus: 'to_confirm' });
  });
  it('a note with no capture time (older notes) keeps the previous anchor', async () => {
    const { userId, clientId } = await rep();
    const n = await deps.notes.create(userId, { clientId, source: 'paste', rawText: TEXT, audioKey: null, status: 'pending_extraction' });
    await deps.extraction.extractNote(userId, n.id, '2026-11-10');
    expect(await dueOf(userId)).toMatchObject({ dueDate: '2026-11-12' });
  });
});

describe('[P57-2] the routes record the capture moment', () => {
  const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 5, 6, 7, 8]);
  const voice = (r: { token: string; clientId: string }, capturedAt?: string) => fetch(`${base}/clients/${r.clientId}/notes/voice`, { method: 'POST', headers: { authorization: `Bearer ${r.token}`, 'content-type': 'audio/webm', ...(capturedAt ? { 'x-tovira-captured-at': capturedAt } : {}) }, body: WEBM });
  it('a typed note: the save time', async () => {
    const r = await rep();
    const before = Date.now();
    const res = await fetch(`${base}/clients/${r.clientId}/notes/paste`, { method: 'POST', headers: h(r.token), body: JSON.stringify({ text: TEXT }) });
    const { id } = (await res.json()) as { id: string };
    expect((await deps.notes.findByIdForUser(r.userId, id))!.capturedAt).toBeGreaterThanOrEqual(before);
  });
  it('a voice note recorded two days ago and uploaded now keeps its recording time', async () => {
    const r = await rep();
    const at = Date.now() - 2 * 86_400_000;
    const { id } = (await (await voice(r, String(at))).json()) as { id: string };
    expect((await deps.notes.findByIdForUser(r.userId, id))!.capturedAt).toBe(at);
  });
  it('NEGATIVE: a recording time in the future, over 30 days old, or not a number is ignored (the upload time is used)', async () => {
    const r = await rep();
    for (const bad of [String(Date.now() + 3_600_000), String(Date.now() - 31 * 86_400_000), 'yesterday']) {
      const before = Date.now();
      const { id } = (await (await voice(r, bad)).json()) as { id: string };
      const got = (await deps.notes.findByIdForUser(r.userId, id))!.capturedAt!;
      expect(got, bad).toBeGreaterThanOrEqual(before);
      expect(got, bad).toBeLessThanOrEqual(Date.now());
    }
  });
  it('an "Add a note" capture: the save time', async () => {
    const r = await rep();
    const before = Date.now();
    const { capture } = (await (await fetch(`${base}/captures`, { method: 'POST', headers: h(r.token), body: JSON.stringify({ clientId: r.clientId, statement: TEXT }) })).json()) as { capture: { noteId: string } };
    expect((await deps.notes.findByIdForUser(r.userId, capture.noteId))!.capturedAt).toBeGreaterThanOrEqual(before);
  });
});
