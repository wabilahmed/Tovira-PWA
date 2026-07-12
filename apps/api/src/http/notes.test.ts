import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';

const stubPool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;

let server: Server;
let base: string;
let storage: InMemoryStorage;

beforeAll(async () => {
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 60 * 60 * 1000,
  });
  storage = new InMemoryStorage();
  server = createApiServer({
    pool: stubPool,
    auth,
    clients: new InMemoryClientRepository(),
    notes: new InMemoryNoteRepository(),
    storage,
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { token: string }).token;
}
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { id: string }).id;
}
function uploadVoice(token: string, clientId: string, bytes: Uint8Array): Promise<Response> {
  return fetch(`${base}/clients/${clientId}/notes/voice`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' },
    body: bytes,
  });
}

const audio = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('voice note upload', () => {
  it('stores the raw audio and creates a pending-transcription note under the client', async () => {
    const token = await signup('rec@example.com');
    const clientId = await createClient(token, 'Meridian Corp');
    const res = await uploadVoice(token, clientId, audio);
    expect(res.status).toBe(201);
    const note = (await res.json()) as { id: string; source: string; status: string; audioKey: string };
    expect(note.source).toBe('voice');
    expect(note.status).toBe('pending_transcription');
    expect(storage.has(note.audioKey)).toBe(true); // audio persisted server-side

    // Appears in the client's notes.
    const list = (await (await fetch(`${base}/clients/${clientId}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ id: string }> };
    expect(list.notes.map((n) => n.id)).toContain(note.id);
  });

  it('serves the stored audio back for playback', async () => {
    const token = await signup('play@example.com');
    const clientId = await createClient(token, 'Acme');
    const note = (await (await uploadVoice(token, clientId, audio)).json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/audio`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect([...body]).toEqual([...audio]);
  });

  // NEGATIVE
  it('rejects an unauthenticated upload with 401', async () => {
    const res = await fetch(`${base}/clients/whatever/notes/voice`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: audio,
    });
    expect(res.status).toBe(401);
  });

  it('does not let a rep upload to another rep\'s client (404, isolation)', async () => {
    const tokenA = await signup('a-rec@example.com');
    const tokenB = await signup('b-rec@example.com');
    const clientA = await createClient(tokenA, 'A Corp');
    const res = await uploadVoice(tokenB, clientA, audio);
    expect(res.status).toBe(404);
  });

  it('returns 404 uploading to a non-existent client', async () => {
    const token = await signup('missing@example.com');
    const res = await uploadVoice(token, '11111111-1111-4111-8111-111111111111', audio);
    expect(res.status).toBe(404);
  });

  it('rejects an empty audio upload', async () => {
    const token = await signup('emptyaudio@example.com');
    const clientId = await createClient(token, 'Empty');
    const res = await uploadVoice(token, clientId, new Uint8Array([]));
    expect(res.status).toBe(400);
  });
});
