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

/**
 * [FOLLOW-UP 2] Cap a transcript at maxChars, keeping the MOST RECENT part. A WhatsApp export is
 * chronological (oldest first, newest last), so the recent messages are at the END — we keep the tail
 * and drop the partial first line so only whole messages remain. Returns whether it was truncated.
 */
export function truncateToRecent(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const tail = text.slice(text.length - maxChars);
  const nl = tail.indexOf('\n');
  return { text: nl >= 0 ? tail.slice(nl + 1) : tail, truncated: true };
}

/** Decode one uploaded file's RAW bytes to its transcript text (the readRawBody path). .zip → inner
 *  transcript (media dropped); bare .txt → UTF-8 text. A transcript longer than BULK_MAX_FILE_CHARS is
 *  truncated to its most recent part (flagged), not dropped. A corrupt/unreadable file → '' (unparseable). */
export function decodeBulkFileBytes(name: string, bytes: Uint8Array): BulkInputFile {
  try {
    const r = resolveTranscript(Buffer.from(bytes));
    const { text, truncated } = truncateToRecent(r.ok ? r.text : '', BULK_MAX_FILE_CHARS);
    return { name, content: text, ...(truncated ? { truncated: true } : {}) };
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
  return raw.map((f) => {
    const { text, truncated } = decodeOne(f);
    return { name: f.name, content: text, ...(truncated ? { truncated: true } : {}) };
  });
}

function decodeOne(f: RawBulkFile): { text: string; truncated: boolean } {
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
  // Oversized → keep the most recent part (flagged), not dropped (FOLLOW-UP 2).
  return truncateToRecent(text, BULK_MAX_FILE_CHARS);
}
