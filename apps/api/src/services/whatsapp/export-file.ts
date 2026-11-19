import { isZip, listZipEntries, readZipTextEntry } from '../import/zip.js';
import { parseWhatsAppExport } from '../import/whatsapp.js';
import { BULK_MAX_FILE_CHARS, truncateToRecent } from '../import/bulk-decode.js';
import type { BulkInputFile } from '../import/bulk-parse.js';

/**
 * [P79 · owner] What a file sent to Tovira's WhatsApp number holds, decided by its BYTES, never by the MIME type Meta
 * labels it with (application/zip, application/octet-stream, text/plain, none) or its name.
 *
 *  - A zip (an iPhone export, with or without media): ONLY the chat text is opened, `_chat.txt` (iPhone) or
 *    "WhatsApp Chat with ….txt" (Android), then any other top-level .txt (a localised name) checked by content. Every
 *    other entry (photos, videos, voice notes, PDFs, Office files, nested archives) is never decompressed or read.
 *  - Plain text (an Android .txt): parsed as it is.
 *  - Anything else, or a zip with no chat text in it: not an export.
 *
 * [P79 · owner] A long chat (over the app's 5 million character limit) keeps its LAST 18 MONTHS, counted back from the
 * chat's newest message (so the same file gives the same result whenever it is sent), and is marked as cut; if 18
 * months is still over the limit, the most recent part of it is kept (the app's existing rule). The chat text may be up
 * to WA_MAX_CHAT_TEXT_BYTES unpacked (a 10 MB zip of text holds about 35 MB); past that it is too big.
 *
 * Everything stays in memory; the caller stores only the chat text, and only once it parses. `meta` is the
 * metadata-only line for the log: counts and sizes, never a file name a rep or client chose, never content.
 */
export type ChatExportResult =
  | { ok: true; file: BulkInputFile; meta: ExportMeta }
  | { ok: false; reason: 'not_export' | 'too_large' | 'web_page'; meta: ExportMeta };

export interface ExportMeta {
  kind: 'zip' | 'text' | 'binary' | 'web_page';
  /** zip only */
  entries?: number;
  textEntries?: number;
  otherEntries?: number;
  /** which entry was the chat: the fixed iPhone name, the Android pattern, another .txt, or none */
  chat?: '_chat.txt' | 'android-name' | 'other-txt' | 'none';
  chatBytes?: number;
  /** a long chat: what was kept */
  kept?: string;
  /** why it was refused, in a word */
  why?: string;
}

/** An export with media can hold hundreds of entries; only the directory is walked, nothing in it is inflated. */
export const WA_ZIP_MAX_ENTRIES = 5_000;
/** [P79] The largest chat text read (unpacked): a long chat is cut to its last 18 months after reading. */
export const WA_MAX_CHAT_TEXT_BYTES = 50_000_000;
/** [P79 · owner] What a long chat keeps. */
export const LONG_CHAT_KEEP_MONTHS = 18;
/** At most this many .txt entries are opened looking for the chat. */
const MAX_TEXT_TRIES = 4;

const base = (n: string): string => n.slice(n.lastIndexOf('/') + 1);
const ANDROID_NAME = /^WhatsApp Chat with .+\.txt$/i;

function rank(name: string): 0 | 1 | 2 | null {
  if (name.endsWith('/') || name.startsWith('__MACOSX/')) return null;
  const b = base(name);
  if (b.startsWith('._') || !/\.txt$/i.test(b)) return null;
  if (b === '_chat.txt') return 0;
  if (ANDROID_NAME.test(b)) return 1;
  return name.includes('/') ? null : 2; // another .txt: only at the top level, where WhatsApp puts the chat
}

const parses = (text: string): boolean => {
  try { const r = parseWhatsAppExport(text); return r.ok && r.messages.length > 0; } catch { return false; }
};

const looksLikeWebPage = (text: string): boolean => /^\s*(<!doctype html|<html[\s>])/i.test(text.slice(0, 512));

/** 'YYYY-MM-DDTHH:MM:SS' minus n calendar months (the day clamped to the month's length). */
function monthsBefore(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4)); const mo = Number(iso.slice(5, 7)) - 1 - n; const d = Number(iso.slice(8, 10));
  const first = new Date(Date.UTC(y, mo, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${first.getUTCFullYear()}-${p(first.getUTCMonth() + 1)}-${p(Math.min(d, last))}${iso.slice(10)}`;
}

/** A message's first line → its timestamp, by the import parser itself (one line parsed alone is one message, or none
 *  for a continuation, a system notice or preamble), so the cut reads dates exactly as the import does. */
function lineTimestamp(line: string): string | null {
  if (!line.trim()) return null;
  const r = parseWhatsAppExport(line.endsWith('\r') ? line.slice(0, -1) : line); // CRLF exports
  return r.ok && r.messages.length === 1 ? r.messages[0]!.sentAt : null;
}

/** [P79] A chat over the limit keeps the messages from the 18 months up to its newest one (whole messages, from the
 *  first message on or after the cut-off), then the app's most-recent-part rule if that is still over. */
export function fitLongChat(text: string): { text: string; truncated: boolean; kept?: string } {
  if (text.length <= BULK_MAX_FILE_CHARS) return { text, truncated: false };
  const lines = text.split('\n');
  const stamps = lines.map(lineTimestamp);
  const newest = stamps.reduce<string | null>((a, t) => (t && (!a || t > a) ? t : a), null);
  let cut = text;
  let kept = 'most recent part';
  if (newest) {
    const from = monthsBefore(newest, LONG_CHAT_KEEP_MONTHS);
    const i = stamps.findIndex((t) => t !== null && t >= from);
    if (i > 0) cut = lines.slice(i).join('\n');
    kept = `last ${LONG_CHAT_KEEP_MONTHS} months`;
  }
  const r = truncateToRecent(cut, BULK_MAX_FILE_CHARS);
  return { text: r.text, truncated: true, kept: r.truncated ? `${kept}, then most recent part` : kept };
}

function asFile(name: string, text: string): { file: BulkInputFile; kept?: string } {
  const r = fitLongChat(text);
  return { file: { name, content: r.text, ...(r.truncated ? { truncated: true } : {}) }, ...(r.kept ? { kept: r.kept } : {}) };
}
const ok = (name: string, text: string, meta: ExportMeta): ChatExportResult => {
  const a = asFile(name, text);
  return { ok: true, file: a.file, meta: { ...meta, ...(a.kept ? { kept: a.kept } : {}) } };
};

export function readChatExport(fileName: string, bytes: Uint8Array): ChatExportResult {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (!isZip(buf)) {
    const isText = !buf.includes(0x00) && Buffer.byteLength(buf.toString('utf8'), 'utf8') === buf.length;
    if (!isText) return { ok: false, reason: 'not_export', meta: { kind: 'binary', why: 'not a zip or text' } };
    const text = buf.toString('utf8');
    // What Meta's media host sends instead of the file when a download goes wrong: never the rep's chat.
    if (looksLikeWebPage(text)) return { ok: false, reason: 'web_page', meta: { kind: 'web_page', why: 'a web page, not the file' } };
    return parses(text)
      ? ok(fileName, text, { kind: 'text', chatBytes: buf.length })
      : { ok: false, reason: 'not_export', meta: { kind: 'text', why: 'text is not a WhatsApp chat' } };
  }

  const dir = listZipEntries(buf, WA_ZIP_MAX_ENTRIES);
  if (!dir.ok) return { ok: false, reason: 'not_export', meta: { kind: 'zip', why: 'zip directory unreadable' } };
  const files = dir.entries.filter((e) => !e.name.endsWith('/'));
  const candidates = files
    .map((e) => ({ e, r: rank(e.name) }))
    .filter((c): c is { e: (typeof files)[number]; r: 0 | 1 | 2 } => c.r !== null)
    .sort((a, b) => a.r - b.r || b.e.uncompSize - a.e.uncompSize);
  const meta: ExportMeta = { kind: 'zip', entries: files.length, textEntries: candidates.length, otherEntries: files.length - candidates.length };

  for (const c of candidates.slice(0, MAX_TEXT_TRIES)) {
    const text = readZipTextEntry(buf, c.e, WA_MAX_CHAT_TEXT_BYTES);
    if (text === 'too_large') return { ok: false, reason: 'too_large', meta: { ...meta, chat: c.r === 0 ? '_chat.txt' : c.r === 1 ? 'android-name' : 'other-txt', why: 'chat text over the limit' } };
    if (text === null || !parses(text)) continue;
    return ok(fileName, text, { ...meta, chat: c.r === 0 ? '_chat.txt' : c.r === 1 ? 'android-name' : 'other-txt', chatBytes: Buffer.byteLength(text, 'utf8') });
  }
  return { ok: false, reason: 'not_export', meta: { ...meta, chat: 'none', why: candidates.length ? 'no .txt in it parses as a chat' : 'no chat .txt in the zip' } };
}

/** One log line, metadata only. */
export function exportLogLine(m: { mime: string | null; ext: string; bytes: number; result: string }, meta: ExportMeta): string {
  const parts = [`mime ${m.mime ?? 'none'}`, `ext ${m.ext || 'none'}`, `${m.bytes} bytes`, `kind ${meta.kind}`];
  if (meta.kind === 'zip') parts.push(`entries ${meta.entries ?? 0} (txt ${meta.textEntries ?? 0}, other ${meta.otherEntries ?? 0})`, `chat ${meta.chat ?? 'none'}`);
  if (meta.chatBytes !== undefined) parts.push(`chat text ${meta.chatBytes} bytes`);
  if (meta.kept) parts.push(`long chat: kept ${meta.kept}`);
  parts.push(`result ${m.result}${meta.why ? ` (${meta.why})` : ''}`);
  return `[whatsapp] document: ${parts.join(' · ')}`;
}
