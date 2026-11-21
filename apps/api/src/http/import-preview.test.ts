import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P82-B · owner, 21 Nov] Before an import is confirmed the rep sees "This chat has 1,240 messages to read. About 3
 * minutes." The count is STRIPPED (after the sensitive screen and the chatter pre-filter). The preview stores nothing,
 * calls no model and needs no consent tick yet; the too-long limit counts stripped messages too.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeAll(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function rep(email: string) {
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string };
  const c = (await (await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sara Lee' }) })).json()) as { id: string };
  return { token: s.token, clientId: c.id };
}
const line = (i: number, body: string) => `[2026-01-${String(1 + (i % 28)).padStart(2, '0')}, ${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00] ${i % 2 ? 'Alex Rep' : 'Sara Lee'}: ${body}`;
const exportOf = (bodies: string[]) => bodies.map((b, i) => line(i, b)).join('\n');
const post = (token: string, clientId: string, text: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', ...headers }, body: new TextEncoder().encode(text) });

describe('[P82-B] the import preview', () => {
  it('returns the stripped count, the minutes and the line, and stores nothing (no consent needed yet)', async () => {
    const r = await rep('p1@x.io');
    const res = await post(r.token, r.clientId, exportOf(['Did the quote come through?', 'Sending it today.', '<Media omitted>', 'ok', '👍', 'Thanks, looks good, can we meet Thursday?']), { 'X-Tovira-Preview': '1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preview: true, messagesToRead: 3, minutes: 1, line: 'This chat has 3 messages to read. About 1 minute.' });
    expect(await deps.notes.listByClient((await deps.auth.authenticate(r.token))!.userId, r.clientId)).toEqual([]);
  });
  it('a long chat: thousands separator and minutes from the pieces', async () => {
    const r = await rep('p2@x.io');
    const res = await post(r.token, r.clientId, exportOf(Array.from({ length: 1240 }, (_, i) => `message number ${i}`)), { 'X-Tovira-Preview': '1' });
    expect(((await res.json()) as { line: string }).line).toBe('This chat has 1,240 messages to read. About 5 minutes.');
  });
  it('the too-long limit counts stripped messages: 3,100 lines of which 200 are "ok" is readable', async () => {
    const r = await rep('p3@x.io');
    const bodies = Array.from({ length: 3100 }, (_, i) => (i % 15 === 0 && i < 3000 ? 'ok' : `message number ${i}`));
    const res = await post(r.token, r.clientId, exportOf(bodies), { 'X-Tovira-Preview': '1' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { messagesToRead: number }).messagesToRead).toBe(2900);
  });
  it('NEGATIVE: 3,100 real messages are still too long, with the same refusal', async () => {
    const r = await rep('p4@x.io');
    const res = await post(r.token, r.clientId, exportOf(Array.from({ length: 3100 }, (_, i) => `message number ${i}`)), { 'X-Tovira-Preview': '1' });
    expect(res.status).toBe(413);
  });
  it('NEGATIVE: the preview never carries a currency or a cost', async () => {
    const r = await rep('p5@x.io');
    const body = await (await post(r.token, r.clientId, exportOf(['hello there', 'hi, how are you']), { 'X-Tovira-Preview': '1' })).text();
    expect(body).not.toMatch(/AED|\$|cost|spend|credit|%/i);
  });
});
