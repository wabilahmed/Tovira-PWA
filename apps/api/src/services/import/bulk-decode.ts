/**
 * [BULK-IMPORT · RULING 2 item 1] Decode each uploaded file to its WhatsApp transcript TEXT, accepting
 * both a bare `.txt` (Android) and a `.zip` (what iPhones always export, even "Without media" — a
 * `_chat.txt` plus media). Reuses the single-import resolver EXACTLY (resolveTranscript): the zip is
 * unpacked in memory, the transcript is chosen by content, and media entries are dropped unread. A file
 * that cannot be decoded (corrupt zip, no transcript, or over the size ceiling) becomes empty text, so
 * the deterministic parser marks only THAT row 'unparseable' — the rest of the batch is unaffected.
 */
import { resolveTranscript } from './resolve.js';
import type { BulkInputFile } from './bulk-parse.js';

/** Same per-file ceiling as single import (notes-routes MAX_IMPORT_CHARS): a full multi-year export. */
export const BULK_MAX_FILE_CHARS = 5_000_000;

/**
 * [FIX 1] Max RAW bytes for one uploaded chat file (single and bulk upload through readRawBody — no
 * base64/JSON inflation). Derivation: the largest transcript we accept is BULK_MAX_FILE_CHARS
 * (= MAX_IMPORT_CHARS) characters; a WhatsApp export is text at up to ~2 UTF-8 bytes/char for the
 * scripts we see (Latin + Arabic), so 2 × that many bytes admits any in-ceiling .txt. A .zip is smaller
 * raw (compressed) and its decompressed size is independently capped at BULK_MAX_FILE_CHARS by the zip
 * reader. The decoded TEXT is still truncated to BULK_MAX_FILE_CHARS, so this is only the transport cap.
 */
export const MAX_IMPORT_UPLOAD_BYTES = BULK_MAX_FILE_CHARS * 2; // 10 MB (~9.5 MiB)

/** Decode one uploaded file's RAW bytes to its transcript text (the readRawBody path). .zip → inner
 *  transcript (media dropped); bare .txt → UTF-8 text. Oversized decoded text → '' (unparseable row). */
export function decodeBulkFileBytes(name: string, bytes: Uint8Array): BulkInputFile {
  try {
    const r = resolveTranscript(Buffer.from(bytes));
    const text = r.ok ? r.text : '';
    return { name, content: text.length > BULK_MAX_FILE_CHARS ? '' : text };
  } catch {
    return { name, content: '' };
  }
}

export interface RawBulkFile {
  name: string;
  /** A pasted / Android `.txt` transcript as text. */
  content?: string;
  /** Raw file bytes, base64 — a `.zip` (iOS) or a `.txt`. Decoded by content, never by extension. */
  contentBase64?: string;
}

export function decodeBulkFiles(raw: RawBulkFile[]): BulkInputFile[] {
  return raw.map((f) => ({ name: f.name, content: decodeOne(f) }));
}

function decodeOne(f: RawBulkFile): string {
  let text = '';
  if (typeof f.contentBase64 === 'string' && f.contentBase64.length > 0) {
    try {
      const r = resolveTranscript(Buffer.from(f.contentBase64, 'base64'));
      text = r.ok ? r.text : ''; // corrupt zip / no transcript → empty → 'unparseable' for this row only
    } catch {
      text = '';
    }
  } else if (typeof f.content === 'string') {
    text = f.content;
  }
  // Oversized → drop to unparseable rather than failing the whole batch (same ceiling as single import).
  return text.length > BULK_MAX_FILE_CHARS ? '' : text;
}
