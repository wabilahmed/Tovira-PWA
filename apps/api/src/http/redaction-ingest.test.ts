import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// REDACT-2 + REDACT-4: a Tier-1 value pasted into a note must be redacted BEFORE storage,
// and must therefore appear nowhere downstream — not in the stored note, not in the
// extraction training log (which retains input + output for training).
describe('[REDACT-2/4] Tier-1 values never reach storage or the training log', () => {
  let server: Server;
  let base: string;
  let deps: TestDeps;
  const CARD = '4539 1488 0343 6467';
  const IBAN = 'AE070331234567890123456';

  beforeAll(async () => {
    deps = buildInMemoryDeps();
    server = createApiServer(deps);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('redacts a card + IBAN at paste, and the log never contains them', async () => {
    const signup = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'redact@example.com', password: 'password123' }) });
    const token = (await signup.json() as { token: string }).token;
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const client = await (await fetch(`${base}/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Redact Co' }) })).json() as { id: string };

    const paste = await fetch(`${base}/clients/${client.id}/notes/paste`, { method: 'POST', headers: auth, body: JSON.stringify({ text: `Client sent card ${CARD} and IBAN ${IBAN}. I'll send the invoice Friday.` }) });
    const note = await paste.json() as { id: string; rawText: string };
    expect(paste.status).toBe(201);

    // Stored note is redacted, but the legitimate promise text survives.
    expect(note.rawText).toContain('[card ending 6467]');
    expect(note.rawText).toContain('[IBAN redacted]');
    expect(note.rawText).toContain('send the invoice');
    expect(note.rawText).not.toContain('4539');
    expect(note.rawText).not.toContain(IBAN);

    // Extract, then assert the training log (input + output) carries no Tier-1 value.
    await fetch(`${base}/notes/${note.id}/extract`, { method: 'POST', headers: auth });
    const rows = await deps.extractionLog!.listByUser((await (await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { user: { id: string } }).user.id);
    const blob = rows.map((r) => `${r.input}\n${r.rawOutput ?? ''}`).join('\n');
    expect(blob).not.toContain('4539');
    expect(blob).not.toContain('0343');
    expect(blob).not.toContain(IBAN);
  });
});
