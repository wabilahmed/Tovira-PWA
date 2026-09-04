import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { resolveTranscript } from './resolve.js';

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
interface BuildEntry { name: string; data: Buffer; deflate?: boolean }
function makeZip(entries: BuildEntry[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.deflate ? 8 : 0;
    const stored = e.deflate ? deflateRawSync(e.data) : e.data;
    const lfh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), nameBuf, stored]);
    locals.push(lfh);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
    offset += lfh.length;
  }
  const cd = Buffer.concat(centrals); const localAll = Buffer.concat(locals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(localAll.length), u16(0)]);
  return Buffer.concat([localAll, cd, eocd]);
}

const CHAT = '[15/03/2026, 14:22] Ahmed: looking for a 3-bed in Mirdif\n[15/03/2026, 14:25] Me: on it';
const LONGER = CHAT + '\n[15/03/2026, 14:30] Ahmed: and a maids room please, near a school if possible';

describe('[IMPORT-ZIP] resolveTranscript', () => {
  it('passes a bare .txt buffer through as text (existing path unchanged)', () => {
    const r = resolveTranscript(Buffer.from(CHAT));
    expect(r).toEqual({ ok: true, text: CHAT });
  });

  it('picks the _chat.txt transcript out of an iOS-shaped zip, ignoring media', () => {
    const zip = makeZip([{ name: '_chat.txt', data: Buffer.from(CHAT) }, { name: 'IMG.jpg', data: Buffer.from([0, 255, 0]) }]);
    const r = resolveTranscript(zip);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain('Mirdif');
  });

  it('chooses by content, not filename, and prefers the largest when several parse', () => {
    const zip = makeZip([
      { name: 'aaa.txt', data: Buffer.from(CHAT) },
      { name: 'zzz.txt', data: Buffer.from(LONGER), deflate: true },
      { name: 'notes.txt', data: Buffer.from('random prose, not a chat at all') },
    ]);
    const r = resolveTranscript(zip);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(LONGER); // the longer transcript wins, regardless of name
  });

  it('rejects a zip with no parseable transcript, naming what was found', () => {
    const zip = makeZip([{ name: 'readme.txt', data: Buffer.from('this is not a chat export') }]);
    const r = resolveTranscript(zip);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/no whatsapp transcript/i);
      expect(r.reason).toContain('readme.txt');
    }
  });
});
