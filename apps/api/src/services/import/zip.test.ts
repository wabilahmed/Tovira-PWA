import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { unzipTextEntries, isZip, DEFAULT_ZIP_CAPS } from './zip.js';

// --- Minimal in-memory ZIP builder (STORED method 0, or DEFLATE method 8) for tests. ---
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

interface BuildEntry { name: string; data: Buffer; deflate?: boolean }

function makeZip(entries: BuildEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.deflate ? 8 : 0;
    const stored = e.deflate ? deflateRawSync(e.data) : e.data;
    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), nameBuf, stored,
    ]);
    locals.push(lfh);
    const cdh = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]);
    centrals.push(cdh);
    offset += lfh.length;
  }
  const cd = Buffer.concat(centrals);
  const localAll = Buffer.concat(locals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(localAll.length), u16(0),
  ]);
  return Buffer.concat([localAll, cd, eocd]);
}

const CHAT = '[15/03/2026, 14:22] Ahmed: looking for a 3-bed in Mirdif\n[15/03/2026, 14:25] Me: on it';

describe('[IMPORT-ZIP] isZip', () => {
  it('detects a zip by magic, not extension', () => {
    expect(isZip(makeZip([{ name: 'x.txt', data: Buffer.from('hi') }]))).toBe(true);
    expect(isZip(Buffer.from('[12/01/2026, 10:00] A: hi'))).toBe(false);
  });
});

describe('[IMPORT-ZIP] unzipTextEntries', () => {
  it('extracts an iOS-shaped export (_chat.txt) and ignores media', () => {
    const zip = makeZip([
      { name: '_chat.txt', data: Buffer.from(CHAT) },
      { name: 'IMG-0001.jpg', data: Buffer.from([0x00, 0xff, 0x00, 0xd8]) }, // binary media
    ]);
    const r = unzipTextEntries(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name)).toEqual(['_chat.txt']);
    expect(r.entries[0]!.text).toContain('Mirdif');
  });

  it('handles a DEFLATE-compressed transcript', () => {
    const zip = makeZip([{ name: 'WhatsApp Chat with Omar.txt', data: Buffer.from(CHAT), deflate: true }]);
    const r = unzipTextEntries(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]!.text).toContain('Mirdif');
  });

  it('returns every text entry so the caller can pick by parsing (content, not name)', () => {
    const zip = makeZip([
      { name: 'readme', data: Buffer.from('not a chat') },
      { name: 'chat-ar.txt', data: Buffer.from(CHAT) },
    ]);
    const r = unzipTextEntries(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name).sort()).toEqual(['chat-ar.txt', 'readme']);
  });

  it('rejects too many entries (fail closed)', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') }));
    const r = unzipTextEntries(makeZip(many), { ...DEFAULT_ZIP_CAPS, maxEntries: 4 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/too many entries/i);
  });

  it('rejects an entry that exceeds the per-entry cap, extracting nothing', () => {
    const zip = makeZip([{ name: 'big.txt', data: Buffer.from('a'.repeat(2000)) }]);
    const r = unzipTextEntries(zip, { ...DEFAULT_ZIP_CAPS, maxEntryBytes: 1000 });
    expect(r.ok).toBe(false);
  });

  it('rejects a nested archive by name', () => {
    const zip = makeZip([{ name: 'inner.zip', data: Buffer.from('PKjunk') }]);
    const r = unzipTextEntries(zip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/nested archive/i);
  });

  it('rejects a nested archive smuggled under a .txt name (magic check)', () => {
    const inner = makeZip([{ name: 'a.txt', data: Buffer.from('hi') }]);
    const zip = makeZip([{ name: 'notazip.txt', data: inner }]);
    const r = unzipTextEntries(zip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/nested archive/i);
  });

  it('rejects a non-zip buffer', () => {
    const r = unzipTextEntries(Buffer.from('just some text'));
    expect(r.ok).toBe(false);
  });
});
