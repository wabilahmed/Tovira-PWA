import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readChatExport, exportLogLine, fitLongChat, WA_ZIP_MAX_ENTRIES, WA_MAX_CHAT_TEXT_BYTES } from './export-file.js';
import { parseWhatsAppExport } from '../import/whatsapp.js';
import { BULK_MAX_FILE_CHARS } from '../import/bulk-decode.js';
import { resolveTranscript } from '../import/resolve.js';
import { buildZip, iphoneZipWithMedia, iphoneZipWithoutMedia, IPHONE_CHAT } from './__fixtures__/iphone-export-zip.js';

/**
 * [P79 · owner] An iPhone export sent to Tovira's WhatsApp number was refused ("That doesn't look like a WhatsApp chat
 * export"). The in-app reader rejects a whole zip when any one file in it is over 5 MB, is itself a zip (a .docx), or
 * there are more than 128 files, so an export WITH media failed. The WhatsApp path now opens only the chat text.
 */
const NAME = 'WhatsApp Chat - Anjali Mehra.zip';
const chat = (text = IPHONE_CHAT) => ({ name: '_chat.txt', data: Buffer.from(text), deflate: true, descriptor: true });
const bin = (name: string, n = 2000) => ({ name, data: Buffer.alloc(n, 0), deflate: false });

describe('[P79] the iPhone zip, with and without media', () => {
  it('without media: the chat text is found and read', () => {
    const r = readChatExport(NAME, iphoneZipWithoutMedia());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file).toEqual({ name: NAME, content: IPHONE_CHAT });
    expect(r.meta).toMatchObject({ kind: 'zip', entries: 1, chat: '_chat.txt' });
  });

  it('with media (a 6 MB video, a photo, a .docx, a voice note, a PDF, a contact card): only the chat text, the same as without', () => {
    const z = iphoneZipWithMedia();
    expect(z.length).toBeGreaterThan(6_000_000);
    // what refused it before: the in-app reader turns the whole zip down
    expect(resolveTranscript(Buffer.from(z)).ok).toBe(false);
    const r = readChatExport(NAME, z);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const without = readChatExport(NAME, iphoneZipWithoutMedia());
    expect(without.ok && r.file).toEqual(without.ok && without.file);
    expect(r.meta).toMatchObject({ kind: 'zip', entries: 7, textEntries: 1, otherEntries: 6, chat: '_chat.txt' });
    for (const media of ['VCARD', 'OggS', '%PDF', 'Content_Types']) expect(r.file.content).not.toContain(media);
  });

  it('the Android name inside a zip is found too, and a localised .txt by content', () => {
    const android = readChatExport('x.zip', new Uint8Array(buildZip([bin('IMG-1.jpg'), { name: 'WhatsApp Chat with Anjali Mehra.txt', data: Buffer.from(IPHONE_CHAT), deflate: true }])));
    expect(android.ok && android.meta.chat).toBe('android-name');
    const localised = readChatExport('x.zip', new Uint8Array(buildZip([{ name: 'Chat de WhatsApp con Anjali.txt', data: Buffer.from(IPHONE_CHAT), deflate: true }])));
    expect(localised.ok && localised.meta.chat).toBe('other-txt');
  });

  it('_chat.txt wins over any other .txt; macOS ._ copies and folders are never the chat', () => {
    const other = '[01/01/2026, 10:00:00] Someone Else: a different, longer chat that is not the export at all, repeated. '.repeat(20);
    const r = readChatExport('x.zip', new Uint8Array(buildZip([
      { name: '__MACOSX/._chat.txt', data: Buffer.from(other), deflate: false },
      { name: '._chat.txt', data: Buffer.from(other), deflate: false },
      { name: 'notes.txt', data: Buffer.from(other), deflate: false },
      chat(),
    ])));
    expect(r.ok && r.file.content).toBe(IPHONE_CHAT);
  });

  it('media is never decompressed: a bomb, a corrupt file and a nested zip next to the chat are ignored', () => {
    const bomb = deflateRawSync(Buffer.alloc(50_000_000, 0x41)); // 50 MB of A's, tiny compressed
    const r = readChatExport(NAME, new Uint8Array(buildZip([
      { name: 'bomb.jpg', data: bomb, deflate: false },
      { name: 'inner.zip', data: buildZip([chat()]), deflate: false },
      { name: 'corrupt.mp4', data: Buffer.from([1, 2, 3, 4, 5]), deflate: false },
      chat(),
    ])));
    expect(r.ok).toBe(true);
  });

  it('hundreds of photos are fine (the in-app cap of 128 files does not apply here)', () => {
    const photos = Array.from({ length: 400 }, (_, i) => bin(`000${i}-PHOTO.jpg`, 10));
    expect(readChatExport(NAME, new Uint8Array(buildZip([chat(), ...photos]))).ok).toBe(true);
  });
});

describe('[P79] whatever MIME type or name Meta gives it: decided by the bytes', () => {
  it('a zip named .txt, a .txt named .zip, no name at all: all read the same', () => {
    expect(readChatExport('chat.txt', iphoneZipWithoutMedia()).ok).toBe(true);
    expect(readChatExport('WhatsApp Chat with A.zip', new TextEncoder().encode(IPHONE_CHAT)).ok).toBe(true);
    expect(readChatExport('', iphoneZipWithoutMedia()).ok).toBe(true);
  });
});

describe('[P79] NEGATIVE: what is refused', () => {
  it('a zip with no chat in it: media only, or a .txt that is not a chat', () => {
    expect(readChatExport(NAME, new Uint8Array(buildZip([bin('IMG.jpg'), bin('VID.mp4')])))).toMatchObject({ ok: false, reason: 'not_export', meta: { chat: 'none' } });
    expect(readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: Buffer.from('shopping list: milk'), deflate: true }])))).toMatchObject({ ok: false, reason: 'not_export' });
  });
  it('a _chat.txt that is really a zip, or binary, is not a chat', () => {
    expect(readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: buildZip([chat()]), deflate: false }])))).toMatchObject({ ok: false, reason: 'not_export' });
    expect(readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: Buffer.alloc(100, 0), deflate: true }])))).toMatchObject({ ok: false, reason: 'not_export' });
  });
  it('a chat text over the 50 MB reading limit is "too big", deflated or stored, never inflated past it', () => {
    const huge = Buffer.alloc(WA_MAX_CHAT_TEXT_BYTES + 1, 0x41);
    expect(readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: huge, deflate: true }])))).toMatchObject({ ok: false, reason: 'too_large' });
    expect(readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: huge, deflate: false }])))).toMatchObject({ ok: false, reason: 'too_large' });
  });
  it('a broken zip, a zip past the entry ceiling, a photo, a web page', () => {
    const z = Buffer.from(iphoneZipWithoutMedia());
    expect(readChatExport(NAME, new Uint8Array(z.subarray(0, z.length - 10)))).toMatchObject({ ok: false, reason: 'not_export' });
    const many = Array.from({ length: WA_ZIP_MAX_ENTRIES + 1 }, (_, i) => bin(`${i}.jpg`, 1));
    expect(readChatExport(NAME, new Uint8Array(buildZip(many)))).toMatchObject({ ok: false, reason: 'not_export' });
    expect(readChatExport('IMG.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]))).toMatchObject({ ok: false, reason: 'not_export', meta: { kind: 'binary' } });
    expect(readChatExport(NAME, new TextEncoder().encode('<!DOCTYPE html><html><body>Sorry</body></html>'))).toMatchObject({ ok: false, reason: 'web_page' });
  });
});

describe('[P79] the log line is metadata only', () => {
  it('counts and sizes, never a name or a word of the chat', () => {
    const r = readChatExport(NAME, iphoneZipWithMedia());
    const line = exportLogLine({ mime: 'application/octet-stream', ext: '.zip', bytes: 6_229_730, result: 'staged' }, r.meta);
    expect(line).toBe(`[whatsapp] document: mime application/octet-stream · ext .zip · 6229730 bytes · kind zip · entries 7 (txt 1, other 6) · chat _chat.txt · chat text ${Buffer.byteLength(IPHONE_CHAT)} bytes · result staged`);
    for (const word of ['Anjali', 'Mehra', 'quote', 'Wabil', 'PHOTO', 'Proposal']) expect(line).not.toContain(word);
  });
});

// [P79 · owner] The owner's own chat was 19.3 MB of text (259,672 messages, 2021 to 2026), no media: the 5 MB limit, not
// media, refused it. Owner: a chat this long keeps its last 18 months.
describe('[P79] a long chat keeps its last 18 months', () => {
  /** One message a day (each ~`pad` chars long), oldest first, ending on `end` (YYYY-MM-DD). */
  function longChat(days: number, end: string, pad = 200): string {
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(endMs - i * 86_400_000);
      const dd = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      out.push(`[${dd}, 10:00:00\u202fAM] ${i % 2 ? 'Anjali Mehra' : 'Wabil'}: day ${i} ${'x'.repeat(pad)}`);
      if (i % 7 === 0) out.push('a second line of the same message'); // continuation lines stay with their message
    }
    return out.join('\r\n');
  }
  const datesOf = (t: string) => { const r = parseWhatsAppExport(t); return r.ok ? r.messages.map((m) => m.sentAt!.slice(0, 10)) : []; };

  it('six years over the limit: from the same day 18 months before the newest message, whole messages, marked as cut', () => {
    const text = longChat(6 * 365, '2026-11-19', 3000); // ~6.6M chars
    expect(text.length).toBeGreaterThan(BULK_MAX_FILE_CHARS);
    const r = fitLongChat(text);
    expect(r).toMatchObject({ truncated: true, kept: 'last 18 months' });
    const d = datesOf(r.text);
    expect(d[0]).toBe('2025-05-19');
    expect(d.at(-1)).toBe('2026-11-19');
    expect(datesOf(text).filter((x) => x >= '2025-05-19')).toEqual(d); // every message in the window, nothing else
    expect(r.text.startsWith('[19/05/2025')).toBe(true);
  });

  it('counted from the newest message, not from today: an old chat still keeps its last 18 months', () => {
    const r = fitLongChat(longChat(6 * 365, '2023-03-31', 3000));
    expect(datesOf(r.text)[0]).toBe('2021-09-30'); // 31 Sep does not exist: the day is clamped
  });

  it('18 months still over the limit: the most recent part of them', () => {
    const r = fitLongChat(longChat(3 * 365, '2026-11-19', 10_000)); // 18 months alone is ~5.5M chars
    expect(r.kept).toBe('last 18 months, then most recent part');
    expect(r.text.length).toBeLessThanOrEqual(BULK_MAX_FILE_CHARS);
    expect(datesOf(r.text).at(-1)).toBe('2026-11-19');
  });

  it('NEGATIVE: a chat under the limit is untouched, however many years it covers', () => {
    const text = longChat(6 * 365, '2026-11-19', 50);
    expect(text.length).toBeLessThan(BULK_MAX_FILE_CHARS);
    expect(fitLongChat(text)).toEqual({ text, truncated: false });
  });

  it('through the zip: the long iPhone chat is read, cut, marked, and the log says so', () => {
    const r = readChatExport(NAME, new Uint8Array(buildZip([{ name: '_chat.txt', data: Buffer.from(longChat(6 * 365, '2026-11-19', 3000)), deflate: true, descriptor: true }])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.truncated).toBe(true);
    expect(datesOf(r.file.content)[0]).toBe('2025-05-19');
    expect(exportLogLine({ mime: 'application/zip', ext: '.zip', bytes: 1, result: 'staged' }, r.meta)).toContain('· long chat: kept last 18 months ·');
  });
});
