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
