import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import { modelSafeText } from '../services/import/dedup.js';
import { dropSensitiveSpans } from '../services/extraction/receipt-postcheck.js';
import type { ModelClient } from '../ports/model.js';
import type { Extraction } from '../services/extraction/types.js';

// [P55-3 · owner] One precise list on every capture path. Chats, pasted notes and voice transcripts: a sentence (or chat
// message) the precise list flags is withheld from every model send; an ordinary business sentence the broad screen used
// to flag ("I'll call you back Friday") now reaches the model. The note itself is stored and shown to the rep unchanged.
// Receipts: a quote the precise list flags is dropped (the fact stays, without its quote).
let server: Server; let base: string; let deps: TestDeps;
const sent: string[] = [];
const model: ModelClient = { complete: async (req) => { sent.push(JSON.stringify(req)); return { text: JSON.stringify({ summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }; } };
beforeEach(async () => {
  sent.length = 0;
  deps = buildInMemoryDeps({}, { modelClient: model });
  server = createApiServer(deps);
  base = await listenForTest(server);
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(): Promise<{ token: string; userId: string; clientId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ name: 'Omar Haddad' }) })).json()) as { id: string }).id;
  return { token: b.token, userId: b.user.id, clientId };
}
const SENSITIVE = 'He has diabetes, so he wants a ground-floor flat.';
const ORDINARY = "I'll call you back on Friday.";

describe('[P55-3] model-safe text (the one chokepoint every model send uses)', () => {
  it('a pasted or voice note: the flagged sentence is withheld, the rest kept', () => {
    expect(modelSafeText({ rawText: `Met Omar today. ${SENSITIVE} ${ORDINARY}` })).toBe(`Met Omar today. ${ORDINARY}`);
  });
  it('a semicolon ends a clause: the promise after it still reaches the model', () => {
    expect(modelSafeText({ rawText: 'Buyer was diagnosed with cancer; send the revised quote by Friday' })).toBe('send the revised quote by Friday');
  });
  it('NEGATIVE: ordinary words and festival names used as dates are kept', () => {
    const t = "I'll get back to you Monday. After Ramadan he will sign. The court date for the lease is Tuesday.";
    expect(modelSafeText({ rawText: t })).toBe(t);
  });
});

describe('[P55-3] each capture path', () => {
  it('chat import (client page): a flagged message is withheld; "call you back" is not (it used to be)', async () => {
    const { token, userId, clientId } = await rep();
    const chat = ['13/07/2026, 9:00 am - Wabil: hi', '13/07/2026, 9:01 am - Omar Haddad: I have diabetes, ground floor please', "13/07/2026, 9:02 am - Omar Haddad: I'll call you back on Friday"].join('\n');
    const res = await fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: h(token), body: JSON.stringify({ firstImportAck: true, consent: true, content: chat }) });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const [note] = await deps.notes.listByClient(userId, clientId);
    const msgs = note!.messages!;
    expect(msgs.find((m) => m.body.includes('diabetes'))).toMatchObject({ excluded: true });
    expect(msgs.find((m) => m.body.includes('call you back'))!.excluded).toBeFalsy();
  });

  it('chat import (bulk / New client from a chat): the same', async () => {
    const { token, userId } = await rep();
    const chat = ['13/07/2026, 9:00 am - Wabil: hi', '13/07/2026, 9:01 am - Layla: I have diabetes, ground floor please', "13/07/2026, 9:02 am - Layla: I'll call you back on Friday"].join('\n');
    await fetch(`${base}/import/bulk/files`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': 'b1', 'x-tovira-index': '0', 'x-tovira-name': 'chat.txt' }, body: new TextEncoder().encode(chat) });
    const res = await fetch(`${base}/import/bulk`, { method: 'POST', headers: h(token), body: JSON.stringify({ batchId: 'b1', decisions: [{ fileName: 'chat.txt', action: 'new', name: 'Layla' }], firstImportAck: true }) });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    let msgs: Array<{ body: string; excluded?: boolean }> = [];
    for (let i = 0; i < 200 && msgs.length === 0; i++) {
      const c = (await deps.clients.listByUser(userId)).find((x) => x.name === 'Layla');
      msgs = c ? ((await deps.notes.listByClient(userId, c.id))[0]?.messages ?? []) : [];
      if (msgs.length === 0) await new Promise((r) => setTimeout(r, 10));
    }
    expect(msgs.find((m) => m.body.includes('diabetes'))).toMatchObject({ excluded: true });
    expect(msgs.find((m) => m.body.includes('call you back'))!.excluded).toBeFalsy();
  });

  it('pasted note: the flagged sentence never reaches the model; the rep\'s note is stored whole', async () => {
    const { userId, clientId } = await rep();
    const note = await deps.notes.create(userId, { clientId, source: 'paste', rawText: `Met Omar today. ${SENSITIVE} ${ORDINARY}`, audioKey: null, status: 'pending_extraction' });
    await deps.extraction.extractNote(userId, note.id, '2026-07-13');
    expect(sent.join('\n')).not.toContain('diabetes');
    expect(sent.join('\n')).toContain('call you back on Friday');
    expect((await deps.notes.findByIdForUser(userId, note.id))!.rawText).toContain('diabetes');
  });

  it('voice note (transcript): the same', async () => {
    const { userId, clientId } = await rep();
    const note = await deps.notes.create(userId, { clientId, source: 'voice', rawText: `Spoke to Omar. ${SENSITIVE} ${ORDINARY}`, audioKey: null, status: 'pending_extraction' });
    await deps.extraction.extractNote(userId, note.id, '2026-07-13');
    expect(sent.join('\n')).not.toContain('diabetes');
    expect(sent.join('\n')).toContain('call you back on Friday');
  });
});

describe('[P55-3] receipts', () => {
  const ex = (span: string) => ({ summary: '', promises: [{ text: 'Find a ground-floor flat', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: span, source_message_at: null }], people: [{ name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: span, source_message_at: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) as unknown as Extraction;
  it('a quote the precise list flags is dropped; the fact stays', () => {
    const e = ex('Sir medical report आ गई, hepatitis B positive आया है।');
    expect(dropSensitiveSpans(e)).toBe(2);
    expect(e.promises[0]!.source_span).toBeNull();
    expect(e.promises[0]!.text).toBe('Find a ground-floor flat');
    expect((e.people[0] as { source_span: string | null }).source_span).toBeNull();
  });
  it('NEGATIVE: an ordinary quote keeps its receipt', () => {
    const e = ex("I'll call you back on Friday");
    expect(dropSensitiveSpans(e)).toBe(0);
    expect(e.promises[0]!.source_span).toBe("I'll call you back on Friday");
  });
});
