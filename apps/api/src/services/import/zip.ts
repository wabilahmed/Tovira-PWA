import { inflateRawSync } from 'node:zlib';

/**
 * [IMPORT-ZIP] A minimal, dependency-free ZIP reader for WhatsApp exports.
 *
 * A real WhatsApp export on iOS is a `.zip` containing a `_chat.txt` (plus media). We only need
 * the text transcript, so this parses the ZIP central directory, enforces zip-bomb caps BEFORE
 * decompressing, and returns the text-ish entries decoded as UTF-8 — the caller decides which one
 * is the transcript by trying to PARSE each (content, not filename). Media (binary) entries are
 * dropped. Everything stays in memory; nothing is ever written to disk.
 *
 * This is a public upload endpoint, so the caps are load-bearing, not decoration: a cap can only
 * fail closed (reject), never truncate-and-continue.
 */
export interface ZipCaps {
  maxEntries: number; // total central-directory records
  maxTotalBytes: number; // summed decompressed size across all extracted text entries
  maxEntryBytes: number; // decompressed size of any single entry (enforced by zlib maxOutputLength too)
}

// Defaults sized to the import ceiling (a chat export is text; a legitimate one is well under this).
export const DEFAULT_ZIP_CAPS: ZipCaps = {
  maxEntries: 128,
  maxTotalBytes: 5_000_000,
  maxEntryBytes: 5_000_000,
};

export interface ZipTextEntry {
  name: string;
  text: string;
}

export type UnzipResult =
  | { ok: true; entries: ZipTextEntry[] }
  | { ok: false; reason: string };

const SIG_EOCD = 0x06054b50; // End Of Central Directory
const SIG_CDH = 0x02014b50; // Central Directory file Header
const SIG_LFH = 0x04034b50; // Local File Header

/** ZIP magic: a local file header (PK\x03\x04) or an empty archive (PK\x05\x06). */
export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

/** A byte sequence looks like text if it decodes as UTF-8 with no NUL bytes (media is binary). */
function looksTextual(buf: Buffer): boolean {
  if (buf.includes(0x00)) return false;
  // A quick validity pass: re-encoding a lossy decode changes length on invalid UTF-8.
  const decoded = buf.toString('utf8');
  return Buffer.byteLength(decoded, 'utf8') === buf.length;
}

interface CentralEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  // EOCD is 22 bytes + an optional trailing comment; scan backwards for its signature.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Decode a ZIP buffer to its text entries, failing closed on any cap breach or malformation.
 */
export function unzipTextEntries(buf: Buffer, caps: ZipCaps = DEFAULT_ZIP_CAPS): UnzipResult {
  if (!isZip(buf)) return { ok: false, reason: 'The upload is not a valid zip archive.' };

  const eocd = findEocd(buf);
  if (eocd < 0) return { ok: false, reason: 'The zip is malformed (no end-of-central-directory record).' };

  const total = buf.readUInt16LE(eocd + 10); // records on this disk
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total > caps.maxEntries) return { ok: false, reason: `The zip has too many entries (${total} > ${caps.maxEntries}).` };
  if (cdOffset >= buf.length) return { ok: false, reason: 'The zip is malformed (bad central-directory offset).' };

  // Walk the central directory.
  const central: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CDH) {
      return { ok: false, reason: 'The zip is malformed (bad central-directory header).' };
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    central.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const entries: ZipTextEntry[] = [];
  let running = 0;
  for (const e of central) {
    if (e.name.endsWith('/')) continue; // directory entry
    // Reject nested archives outright (a classic bomb vector) — by name or by declared size.
    if (e.name.toLowerCase().endsWith('.zip')) return { ok: false, reason: 'The zip contains a nested archive, which is not allowed.' };
    // Per-entry cap on the DECLARED size (cheap pre-check; the real guard is maxOutputLength below).
    if (e.uncompSize > caps.maxEntryBytes) return { ok: false, reason: `A zip entry is too large (${e.uncompSize} bytes > ${caps.maxEntryBytes}).` };

    // Locate the entry data via its local file header.
    const lo = e.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LFH) {
      return { ok: false, reason: 'The zip is malformed (bad local file header).' };
    }
    const lfhNameLen = buf.readUInt16LE(lo + 26);
    const lfhExtraLen = buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + e.compSize;
    if (dataEnd > buf.length) return { ok: false, reason: 'The zip is malformed (entry data out of range).' };
    const compressed = buf.subarray(dataStart, dataEnd);

    let raw: Buffer;
    try {
      if (e.method === 0) {
        raw = Buffer.from(compressed); // STORED
        if (raw.length > caps.maxEntryBytes) return { ok: false, reason: 'A zip entry is too large.' };
      } else if (e.method === 8) {
        // DEFLATE. maxOutputLength makes a lying uncompressed size (a bomb) throw, not balloon.
        raw = inflateRawSync(compressed, { maxOutputLength: caps.maxEntryBytes });
      } else {
        continue; // unsupported compression method — skip, don't fail the whole import
      }
    } catch {
      return { ok: false, reason: 'A zip entry could not be decompressed (it may be corrupt or a decompression bomb).' };
    }

    // Reject a nested archive smuggled under a non-.zip name (magic check on the decompressed
    // bytes) BEFORE the textual skip — a zip is binary, so it would otherwise be silently dropped.
    if (isZip(raw)) return { ok: false, reason: 'The zip contains a nested archive, which is not allowed.' };
    if (!looksTextual(raw)) continue; // media / binary — not a transcript
    running += raw.length;
    if (running > caps.maxTotalBytes) return { ok: false, reason: `The zip's decompressed text exceeds the limit (> ${caps.maxTotalBytes} bytes).` };
    entries.push({ name: e.name, text: raw.toString('utf8') });
  }

  return { ok: true, entries };
}
