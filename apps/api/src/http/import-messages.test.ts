import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P83 · owner, 21 Nov] A chat with more messages to read than the rep has left is refused before anything is stored
 * (no model call), with the messages line, never a cost. The preview says so before the rep confirms. A chat that fits is
 * imported, and its messages are counted once it is read.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeAll(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function rep(email: string) {
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const c = (await (await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sara Lee' }) })).json()) as { id: string };
  return { token: s.token, userId: s.user.id, clientId: c.id };
}
const line = (i: number, body: string) => `[2026-01-${String(1 + (i % 28)).padStart(2, '0')}, ${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00] ${i % 2 ? 'Alex Rep' : 'Sara Lee'}: ${body}`;
const exportOf = (n: number) => Array.from({ length: n }, (_, i) => line(i, `message number ${i}`)).join('\n');
const post = (token: string, clientId: string, text: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'X-Tovira-Consent': '1', 'X-Tovira-First-Import-Ack': '1', 'X-Tovira-Confirm-Import': '1', ...headers }, body: new TextEncoder().encode(text) });
async function useMessages(userId: string, n: number) { expect(await deps.allowanceStatus.chargeMessages(userId, `seed-${userId}-${n}`, n)).toBe(true); }

describe('[P83] imports and the messages left', () => {
  it('NEGATIVE: a chat bigger than what is left is refused, nothing stored, with the messages line', async () => {
    const r = await rep('im1@x.io');
    await useMessages(r.userId, 9800);
    const res = await post(r.token, r.clientId, exportOf(240));
    expect(res.status).toBe(402);
    const b = (await res.json()) as { error: string; message: string };
    expect(b.error).toBe('out_of_messages');
    expect(b.message).toBe('This chat has 240 messages to read. You have 200 left this month. Add more messages to import it now.');
    expect(b.message).not.toMatch(/AED|\$|cost|spend|%/i);
    expect(await deps.notes.listByClient(r.userId, r.clientId)).toEqual([]);
  });
  it('NEGATIVE: with none left, the run-out line: "You\'ve read your 10,000 messages this month. Resets <date>."', async () => {
    const r = await rep('im2@x.io');
    await useMessages(r.userId, 10_000);
    const b = (await (await post(r.token, r.clientId, exportOf(5))).json()) as { message: string };
    expect(b.message).toMatch(/^You've read your 10,000 messages this month\. Resets \d{1,2} [A-Z][a-z]{2}\. Add more messages to import it now\.$/);
  });
  it('the preview says it before the rep confirms', async () => {
    const r = await rep('im3@x.io');
    await useMessages(r.userId, 9800);
    const b = (await (await post(r.token, r.clientId, exportOf(240), { 'X-Tovira-Preview': '1' })).json()) as Record<string, unknown>;
    expect(b).toMatchObject({ preview: true, messagesToRead: 240, notEnough: true, messagesLeft: 200, notEnoughLine: 'This chat has 240 messages to read. You have 200 left this month.' });
  });
  it('a chat that fits is imported; its messages are counted when it is read, once', async () => {
    const r = await rep('im4@x.io');
    await useMessages(r.userId, 9000);
    expect((await post(r.token, r.clientId, exportOf(240))).status).toBeLessThan(300);
    await deps.runSweep();
    await deps.runSweep();
    expect((await deps.allowanceStatus.status(r.userId)).messagesUsed).toBe(9240);
  });
  it('a typed note never counts against the messages', async () => {
    const r = await rep('im5@x.io');
    await useMessages(r.userId, 10_000);
    const res = await fetch(`${base}/clients/${r.clientId}/notes/paste`, { method: 'POST', headers: { authorization: `Bearer ${r.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Met Sara, she wants a 3 bed in the Marina.' }) });
    expect(res.status).toBe(201);
    await deps.runSweep();
    expect((await deps.allowanceStatus.status(r.userId)).messagesUsed).toBe(10_000);
  });
});
