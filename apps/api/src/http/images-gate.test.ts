import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { AUDIO_ELSEWHERE_MESSAGE, NOT_AN_IMAGE_MESSAGE } from '../services/media/sniff.js';

let server: Server;
let base: string;
let cookie: string;
let clientId: string;

const bytes = (...parts: Array<number[] | string>): Buffer => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Buffer.from(out);
};
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const OPUS = bytes('OggS', [0, 2]);
const ZIP = bytes('PK', [0x03, 0x04]);

const postImage = (body: Buffer, contentType = 'image/png') =>
  fetch(`${base}/clients/${clientId}/images`, { method: 'POST', headers: { 'content-type': contentType, cookie }, body });

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

describe('[IMAGES-GATE] POST /clients/:id/images allow-lists real image bytes', () => {
  it('accepts PNG and JPEG', async () => {
    expect((await postImage(PNG)).status).toBe(201);
    expect((await postImage(JPEG, 'image/jpeg')).status).toBe(201);
  });

  it('refuses audio bytes with the voice message (even when declared content-type image/png)', async () => {
    const res = await postImage(OPUS, 'image/png'); // spoofed header, opus body
    expect(res.status).toBe(415);
    expect((await res.json() as { message: string }).message).toBe(AUDIO_ELSEWHERE_MESSAGE);
  });

  it('refuses a non-image, non-audio file (e.g. a zip) with the not-an-image message', async () => {
    const res = await postImage(ZIP, 'image/png');
    expect(res.status).toBe(415);
    expect((await res.json() as { message: string }).message).toBe(NOT_AN_IMAGE_MESSAGE);
  });

  it('refuses an empty body (400)', async () => {
    expect((await postImage(Buffer.alloc(0))).status).toBe(400);
  });
});
