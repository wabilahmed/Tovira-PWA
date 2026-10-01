import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { AUDIO_ELSEWHERE_MESSAGE, VOICE_TOO_LONG_MESSAGE } from '../services/media/sniff.js';

let server: Server;
let base: string;
let cookie: string;
let clientId: string;

const bytes = (...parts: Array<number[] | string>): Buffer => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Buffer.from(out);
};
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], [0, 0, 0, 0]);
const MP4 = bytes([0x00, 0x00, 0x00, 0x20], 'ftyp', 'M4A ');
const OGG_OPUS = bytes('OggS', [0, 2, 0, 0]); // a WhatsApp voice note

const postVoice = (body: Buffer) =>
  fetch(`${base}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { 'content-type': 'audio/webm', cookie }, body });

beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@x.ae', password: 'password123' }) });
  cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const c = await fetch(`${base}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Acme' }) });
  clientId = ((await c.json()) as { id: string }).id;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[VOICE-GATE] POST /clients/:id/notes/voice accepts only the app recorder container', () => {
  it('accepts a WebM recording (Chrome/Android/Firefox)', async () => {
    expect((await postVoice(WEBM)).status).toBe(201);
  });

  it('accepts an MP4 recording (Safari/iOS)', async () => {
    expect((await postVoice(MP4)).status).toBe(201);
  });

  it('refuses a WhatsApp voice note (Ogg/Opus) with the one-line message — the target', async () => {
    const res = await postVoice(OGG_OPUS);
    expect(res.status).toBe(415);
    expect((await res.json() as { message: string }).message).toBe(AUDIO_ELSEWHERE_MESSAGE);
  });

  it('refuses an .opus RENAMED/relabelled as webm — it sniffs bytes, not the content-type', async () => {
    // same opus bytes, declared content-type audio/webm (as the uploader always does)
    const res = await fetch(`${base}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { 'content-type': 'audio/webm', cookie }, body: OGG_OPUS });
    expect(res.status).toBe(415);
  });

  it('refuses an empty body (400)', async () => {
    expect((await postVoice(Buffer.alloc(0))).status).toBe(400);
  });

  it('refuses a recording over the ~10-minute byte cap with a distinct length message (413)', async () => {
    const tooBig = Buffer.concat([WEBM, Buffer.alloc(11_000_001)]); // > VOICE_MAX_BYTES, valid webm magic
    const res = await postVoice(tooBig);
    expect(res.status).toBe(413);
    expect((await res.json() as { message: string }).message).toBe(VOICE_TOO_LONG_MESSAGE);
  });
});
