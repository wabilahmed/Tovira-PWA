import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';

let server: Server;
let base: string;
let storage: InMemoryStorage;

beforeAll(async () => {
  const deps = buildInMemoryDeps();
  storage = deps.storage;
  server = createApiServer(deps);
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

  // [P1-5] transcribe a voice note (stub transcriber returns "clear transcript")
  it('transcribes a voice note and stores the transcript', async () => {
    const token = await signup('transcribe@example.com');
    const clientId = await createClient(token, 'Transcribe Corp');
    const note = (await (await uploadVoice(token, clientId, audio)).json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/transcribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: { rawText: string; status: string } };
    expect(body.note.rawText).toBe('clear transcript');
    expect(body.note.status).toBe('pending_extraction');
  });

  it('rejects transcribing another rep\'s note (404)', async () => {
    const tokenA = await signup('a-tr@example.com');
    const tokenB = await signup('b-tr@example.com');
    const clientA = await createClient(tokenA, 'A TR');
    const note = (await (await uploadVoice(tokenA, clientA, audio)).json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/transcribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(404);
  });

  // [P2-2] client timeline
  it('lists notes newest-first with date and source', async () => {
    const token = await signup('timeline@example.com');
    const clientId = await createClient(token, 'Timeline Corp');
    const paste = (text: string) =>
      fetch(`${base}/clients/${clientId}/notes/paste`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    await paste('older message here');
    await paste('newer message here');
    const list = (await (await fetch(`${base}/clients/${clientId}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ rawText: string; source: string; createdAt: number }> };
    expect(list.notes[0]!.rawText).toContain('newer'); // newest first
    expect(list.notes[1]!.rawText).toContain('older');
    expect(list.notes[0]!.source).toBe('paste');
    expect(typeof list.notes[0]!.createdAt).toBe('number');
  });

  it('shows a voice note in a processing state before transcription', async () => {
    const token = await signup('processing@example.com');
    const clientId = await createClient(token, 'Processing Corp');
    await uploadVoice(token, clientId, audio);
    const list = (await (await fetch(`${base}/clients/${clientId}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ status: string }> };
    expect(list.notes[0]!.status).toBe('pending_transcription');
  });

  it('never shows another rep\'s notes in a client timeline', async () => {
    const tokenA = await signup('a-tl@example.com');
    const tokenB = await signup('b-tl@example.com');
    const clientA = await createClient(tokenA, 'A Timeline');
    await fetch(`${base}/clients/${clientA}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A private note' }),
    });
    // B asks for A's client timeline → sees nothing (isolation).
    const list = (await (await fetch(`${base}/clients/${clientA}/notes`, {
      headers: { authorization: `Bearer ${tokenB}` },
    })).json()) as { notes: unknown[] };
    expect(list.notes).toEqual([]);
  });

  // [P1-6] extract structured facts from a note (stub model → valid empty facts)
  it('extracts a note and marks it extracted', async () => {
    const token = await signup('extract@example.com');
    const clientId = await createClient(token, 'Extract Corp');
    const noteRes = await fetch(`${base}/clients/${clientId}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'quick catch-up, nothing to action' }),
    });
    const note = (await noteRes.json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/extract`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: { status: string; extracted: unknown } };
    expect(body.note.status).toBe('extracted');
    expect(body.note.extracted).not.toBeNull();
  });

  it('rejects extracting another rep\'s note (404)', async () => {
    const tokenA = await signup('a-ex@example.com');
    const tokenB = await signup('b-ex@example.com');
    const clientA = await createClient(tokenA, 'A EX');
    const note = (await (await fetch(`${base}/clients/${clientA}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello there' }),
    })).json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/extract`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(404);
  });

  // [P1-4] paste a message
  it('stores a pasted message verbatim (emojis + line breaks preserved), queued for extraction', async () => {
    const token = await signup('paste@example.com');
    const clientId = await createClient(token, 'Northwind');
    const text = 'hey 👋 thanks for the samples!\nthe team liked them\n— pricing is still high 💸';
    const res = await fetch(`${base}/clients/${clientId}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as { source: string; rawText: string; status: string };
    expect(note.source).toBe('paste');
    expect(note.rawText).toBe(text); // verbatim
    expect(note.status).toBe('pending_extraction'); // queued for extraction
  });

  it('rejects an empty / whitespace-only paste, storing nothing', async () => {
    const token = await signup('emptypaste@example.com');
    const clientId = await createClient(token, 'Empty Paste');
    for (const text of ['', '   \n\t ']) {
      const res = await fetch(`${base}/clients/${clientId}/notes/paste`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      expect(res.status).toBe(400);
    }
    const list = (await (await fetch(`${base}/clients/${clientId}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: unknown[] };
    expect(list.notes).toEqual([]); // nothing stored
  });

  it('accepts a long paste up to the limit and rejects beyond it with a clear message (no silent truncation)', async () => {
    const token = await signup('longpaste@example.com');
    const clientId = await createClient(token, 'Long Paste');
    const ok = 'x'.repeat(50_000);
    const okRes = await fetch(`${base}/clients/${clientId}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: ok }),
    });
    expect(okRes.status).toBe(201);
    expect(((await okRes.json()) as { rawText: string }).rawText.length).toBe(50_000);

    const tooLong = 'x'.repeat(200_000);
    const bigRes = await fetch(`${base}/clients/${clientId}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: tooLong }),
    });
    expect(bigRes.status).toBe(413);
    expect(((await bigRes.json()) as { message?: string }).message).toBeTruthy();
  });

  it('does not let a rep paste under another rep\'s client (404)', async () => {
    const tokenA = await signup('a-paste@example.com');
    const tokenB = await signup('b-paste@example.com');
    const clientA = await createClient(tokenA, 'A Paste Corp');
    const res = await fetch(`${base}/clients/${clientA}/notes/paste`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'sneaky' }),
    });
    expect(res.status).toBe(404);
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
