import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P36-1] "New client from a chat" lands the rep on the client's page WITH THE IMPORT RUNNING — so the batch
 * status names the client (and note) each chat was filed under as soon as the chat starts, not only once
 * extraction has finished.
 */
let server: Server;
let base: string;
beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const chat = (rep: string, other: string) => [`13/07/2019, 1:00 am - ${rep}: hi`, `13/07/2019, 1:01 am - ${other}: hello about the Marina quote`].join('\n');

describe('[P36-1] the bulk status names the client each chat was filed under', () => {
  it('a "new" chat → status.started[fileName] = { clientId of the created client, noteId }', async () => {
    const signup = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'p36started@example.com', password: 'password123' }) });
    const token = ((await signup.json()) as { token: string }).token;
    const auth = { authorization: `Bearer ${token}` };
    await fetch(`${base}/import/bulk/files`, { method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': 'p36', 'x-tovira-index': '0', 'x-tovira-name': 'a.txt' }, body: new TextEncoder().encode(chat('Wabil', 'Layla')) });
    const res = await fetch(`${base}/import/bulk`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ batchId: 'p36', firstImportAck: true, decisions: [{ fileName: 'a.txt', action: 'new', name: 'Layla' }] }) });
    expect(res.status).toBe(202);
    let status: { done: boolean; started?: Record<string, { clientId: string; noteId: string }> } = { done: false };
    for (let i = 0; i < 50 && !status.done; i += 1) {
      status = await (await fetch(`${base}/import/bulk/p36/status`, { headers: auth })).json() as typeof status;
      if (!status.done) await new Promise((r) => setTimeout(r, 5));
    }
    const clients = (await (await fetch(`${base}/clients`, { headers: auth })).json()) as { clients: Array<{ id: string; name: string }> };
    const layla = clients.clients.find((c) => c.name === 'Layla')!;
    expect(status.started?.['a.txt']?.clientId).toBe(layla.id);
    expect(status.started?.['a.txt']?.noteId).toBeTruthy();
  });
});
