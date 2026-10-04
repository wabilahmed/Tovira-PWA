import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { decodeBulkFiles, BULK_MAX_FILE_CHARS } from './bulk-decode.js';
import { parseBatch } from './bulk-parse.js';

// Synthetic ZIP builder (same shape as resolve.test.ts) — no real export committed.
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
const b64 = (buf: Buffer) => buf.toString('base64');
const IOS_CHAT = '[15/03/2026, 14:22:01] Wabil: hi\n[15/03/2026, 14:25:00] Omar: hello about Mirdif';
const ANDROID_CHAT = '13/07/2019, 1:00 am - Wabil: hi\n13/07/2019, 1:01 am - Layla: hello';
// A jpeg-ish media blob whose bytes must never surface as transcript text.
const MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('[BULK-IMPORT] file decode (.txt AND .zip per file)', () => {
  it('BULK_MAX_FILE_CHARS matches the single-import ceiling', () => {
    expect(BULK_MAX_FILE_CHARS).toBe(5_000_000);
  });

  it('decodes a mixed iOS .zip + Android .txt batch to their transcripts', () => {
    const iosZip = makeZip([{ name: '_chat.txt', data: Buffer.from(IOS_CHAT) }, { name: 'IMG-001.jpg', data: MEDIA }]);
    const out = decodeBulkFiles([
      { name: 'ios.zip', contentBase64: b64(iosZip) },
      { name: 'android.txt', content: ANDROID_CHAT },
    ]);
    expect(out[0]!.content).toBe(IOS_CHAT);
    expect(out[1]!.content).toBe(ANDROID_CHAT);
    // Both parse to a counterpart.
    const r = parseBatch(out, [], 'Wabil');
    expect(r.rows.map((x) => x.counterpart)).toEqual(['Omar', 'Layla']);
    expect(r.rows.every((x) => x.state !== 'unparseable')).toBe(true);
  });

  it('imports text only from a .zip with media — the media bytes are never read', () => {
    const zip = makeZip([{ name: '_chat.txt', data: Buffer.from(IOS_CHAT), deflate: true }, { name: 'VID.mp4', data: MEDIA }]);
    const [file] = decodeBulkFiles([{ name: 'c.zip', contentBase64: b64(zip) }]);
    expect(file!.content).toBe(IOS_CHAT);
    expect(file!.content).not.toContain('JFIF'); // the media never leaks into the transcript
    expect(file!.content).not.toContain('�'); // nor decoded as mojibake text
  });

  it('a corrupt .zip is unparseable for THAT row only — the rest of the batch is fine', () => {
    const corrupt = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('garbage not a real zip central directory')]);
    const out = decodeBulkFiles([
      { name: 'bad.zip', contentBase64: b64(corrupt) },
      { name: 'good.txt', content: ANDROID_CHAT },
    ]);
    expect(out[0]!.content).toBe(''); // corrupt → empty → parses as unparseable
    const r = parseBatch(out, [], 'Wabil');
    expect(r.rows.find((x) => x.fileName === 'bad.zip')!.state).toBe('unparseable');
    expect(r.rows.find((x) => x.fileName === 'good.txt')!.counterpart).toBe('Layla');
  });

  it('an oversized file is dropped to unparseable rather than failing the batch', () => {
    const [file] = decodeBulkFiles([{ name: 'huge.txt', content: 'a'.repeat(BULK_MAX_FILE_CHARS + 1) }]);
    expect(file!.content).toBe('');
  });
});
