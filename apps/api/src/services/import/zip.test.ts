import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { unzipTextEntries, isZip, DEFAULT_ZIP_CAPS } from './zip.js';

// --- Minimal in-memory ZIP builder (STORED method 0, or DEFLATE method 8) for tests. ---
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

// `fakeUncomp` lets a test LIE about an entry's declared uncompressed size (both headers) so a
// DEFLATE bomb can slip past the cheap declared-size pre-check and exercise the real streaming guard.
interface BuildEntry { name: string; data: Buffer; deflate?: boolean; fakeUncomp?: number }

function makeZip(entries: BuildEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.deflate ? 8 : 0;
    const stored = e.deflate ? deflateRawSync(e.data) : e.data;
    const declaredUncomp = e.fakeUncomp ?? e.data.length; // the value written into the headers
    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(declaredUncomp), u16(nameBuf.length), u16(0), nameBuf, stored,
    ]);
    locals.push(lfh);
    const cdh = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(declaredUncomp), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
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

// [IMPORT-ZIP · BOMB] Prove the zip-bomb guards fail CLOSED under the DEFAULT caps — not an inference
// from the source, an executed test. The two vectors a public upload endpoint must survive are a
// decompression bomb (tiny compressed → huge inflated) and an entry-count bomb (10,000 tiny files).
describe('[IMPORT-ZIP · BOMB] fails closed on a decompression bomb and an entry-count bomb', () => {
  it('a DEFLATE entry that LIES about its size and inflates past the cap is rejected — streamed, not fully inflated', () => {
    // 64 MB of one byte → deflates to ~64 KB. Declare a 1 KB uncompressed size so the cheap
    // declared-size pre-check PASSES; only the real streaming guard (inflateRawSync maxOutputLength)
    // can stop it. If the reader fully inflated first, it would allocate 64 MB before any cap applied.
    const INFLATED = 64 * 1024 * 1024;
    const bomb = makeZip([{ name: 'chat.txt', data: Buffer.alloc(INFLATED, 0x41), deflate: true, fakeUncomp: 1000 }]);
    expect(bomb.length).toBeLessThan(DEFAULT_ZIP_CAPS.maxEntryBytes); // compressed well under the cap (a real bomb shape)

    const before = process.memoryUsage().rss;
    const r = unzipTextEntries(bomb); // DEFAULT caps (maxEntryBytes = 5 MB)
    const grewBy = process.memoryUsage().rss - before;

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/decompress|bomb|too large/i); // a clear, closed rejection
    // Bounded memory: zlib's maxOutputLength guarantees it never materialises the full 64 MB. The
    // throw above is the hard proof; this sanity bound (well under the 64 MB inflated size) catches a
    // regression to a full-inflate reader. Generous to stay non-flaky across GC timing.
    expect(grewBy).toBeLessThan(32 * 1024 * 1024);
  });

  it('a STORED entry whose real bytes exceed the cap is rejected even with a lying declared size', () => {
    // method 0 (STORED): the guard is the post-read length check, not maxOutputLength.
    const big = makeZip([{ name: 'chat.txt', data: Buffer.alloc(6_000_000, 0x41), fakeUncomp: 100 }]);
    const r = unzipTextEntries(big); // DEFAULT caps (maxEntryBytes = 5 MB)
    expect(r.ok).toBe(false);
  });

  it('10,000 tiny entries are rejected by the DEFAULT entry cap (128), before any inflation', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') }));
    const r = unzipTextEntries(makeZip(many)); // DEFAULT caps — no lowered test cap
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/too many entries/i);
  });
});
