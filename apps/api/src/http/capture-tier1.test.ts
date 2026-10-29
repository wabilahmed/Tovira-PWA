import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';

// [P57-1 · owner] "Add a note" (the held Ask capture, POST /captures, and the captures Find makes from a conversation)
// stored the rep's statement verbatim and sent it to the model with any Aadhaar, PAN or bank number still in it. Every
// other capture path blanks Tier-1 values before storage (P53). Now this one does too: the stored note, the receipt the
// rep confirms, and every model send carry the placeholder, never the number.
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
const AADHAAR = '2345 6789 0124';

describe('[P57-1] Tier-1 blanking on "Add a note" captures', () => {
  it('an Aadhaar in the statement is blanked in the stored note, the pending receipt and every model send', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ name: 'Ravi Kumar' }) })).json()) as { id: string }).id;
    const res = await fetch(`${base}/captures`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ clientId, statement: `Candidate Aadhaar is ${AADHAAR}, joining Monday` }) });
    expect(res.status, await res.clone().text()).toBe(201);
    const { capture } = (await res.json()) as { capture: { noteId: string; statement: string } };
    expect(capture.statement).not.toContain(AADHAAR);
    expect(capture.statement).toContain('[ID redacted]');
    expect(capture.statement).toContain('joining Monday');
    const note = await deps.notes.findByIdForUser(b.user.id, capture.noteId);
    expect(note!.rawText).not.toContain(AADHAAR);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).not.toContain(AADHAAR);
    expect(sent.join('\n')).not.toContain('2345');
  });
  it('NEGATIVE: an ordinary statement is stored exactly as written', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ name: 'Ravi Kumar' }) })).json()) as { id: string }).id;
    const statement = 'Budget is AED 2.2M, call him +971 50 123 4567 on Sunday';
    const { capture } = (await (await fetch(`${base}/captures`, { method: 'POST', headers: h(b.token), body: JSON.stringify({ clientId, statement }) })).json()) as { capture: { noteId: string; statement: string } };
    expect(capture.statement).toBe(statement);
    expect((await deps.notes.findByIdForUser(b.user.id, capture.noteId))!.rawText).toBe(statement);
  });
});
