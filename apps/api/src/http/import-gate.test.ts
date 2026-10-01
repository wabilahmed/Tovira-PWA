import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { parseWhatsAppExport } from '../services/import/whatsapp.js';
import { AUDIO_ELSEWHERE_MESSAGE } from '../services/media/sniff.js';

describe('[IMPORT-GATE] WhatsApp parser strips attachment markers (incl. filenames) and flags audio', () => {
  const chat = [
    '[2024-01-01, 10:00:00] Dana: following up on the villa',
    '[2024-01-01, 10:01:00] Dana: <attached: 00001234-AUDIO-2024.opus>',
    '[2024-01-01, 10:02:00] Client: audio omitted',
    '[2024-01-01, 10:03:00] Client: <Media omitted>',
  ].join('\n');

  it('no attachment filename or raw marker survives in any stored body; media flag is set', () => {
    const r = parseWhatsAppExport(chat);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bodies = r.messages.map((m) => m.body);
    const joined = bodies.join('\n');
    expect(joined).not.toMatch(/\.opus/i); // the filename is gone
    expect(joined).not.toMatch(/<\s*attached/i); // the marker is gone
    expect(joined).not.toMatch(/audio omitted/i);
    expect(joined).not.toMatch(/<\s*media\s+omitted/i);
    // the attachment messages are neutral placeholders, and each is flagged media:true (incl. "audio omitted")
    expect(r.messages[1]!.body).toBe('[media omitted]');
    expect(r.messages[1]!.media).toBe(true);
    expect(r.messages[2]!.media).toBe(true); // "audio omitted" now detected
    expect(r.messages[3]!.media).toBe(true);
    // real text is untouched
    expect(r.messages[0]!.body).toBe('following up on the villa');
  });
});

describe('[IMPORT-GATE] import endpoint', () => {
  let server: Server;
  let base: string;
  let cookie: string;
  let clientId: string;
  const b64 = (buf: Buffer): string => buf.toString('base64');
  const OGG = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]); // a WhatsApp voice note

  beforeAll(async () => {
    server = createApiServer(buildInMemoryDeps());
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const s = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@x.ae', password: 'password123' }) });
    cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const c = await fetch(`${base}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Dana' }) });
    clientId = ((await c.json()) as { id: string }).id;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  const importBody = (payload: Record<string, unknown>) =>
    fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(payload) });

  it('refuses an audio file (shared via octet-stream / picked directly) with the one-line message', async () => {
    const res = await importBody({ contentBase64: b64(OGG), consent: true, firstImportAck: true });
    expect(res.status).toBe(415);
    expect((await res.json() as { message: string }).message).toBe(AUDIO_ELSEWHERE_MESSAGE);
  });

  it('imports a chat full of voice-note markers as text, with no filename stored and no audio', async () => {
    const chat = [
      '[2024-01-01, 10:00:00] Dana: here is the file you asked for',
      '[2024-01-01, 10:01:00] Dana: <attached: 00009999-AUDIO-2024.opus>',
      '[2024-01-01, 10:02:00] Dana: and one more',
      '[2024-01-01, 10:03:00] Dana: <attached: 00010000-AUDIO-2024.opus>',
    ].join('\n');
    let res = await importBody({ content: chat, consent: true, firstImportAck: true });
    if (res.status === 409) {
      res = await importBody({ content: chat, consent: true, firstImportAck: true, confirmImport: true, misfileAck: true, counterpart: 'Dana' });
    }
    expect(res.status).toBe(202);
    const note = (await res.json() as { note: { rawText: string | null; messages?: Array<{ body: string }> } }).note;
    const text = `${note.rawText ?? ''}\n${(note.messages ?? []).map((m) => m.body).join('\n')}`;
    expect(text).not.toMatch(/\.opus/i); // no attachment filename anywhere in the stored note
    expect(text).not.toMatch(/<\s*attached/i);
    expect(text).toMatch(/\[media omitted\]/); // markers became neutral placeholders
  });
});
