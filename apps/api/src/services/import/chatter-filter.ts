import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P81-1 · owner, 21 Nov] The chatter pre-filter, on in production with the certified v0.9.7 prompt. Before a chat is split
 * into pieces, messages with nothing to extract are left out of what the model reads (they stay stored, and the rep
 * still sees them): media with no caption, deleted messages, stickers, system lines, and a lone ok / okay / thanks /
 * lol / haha / emoji reply. A message with any other word is kept ("ok, send it Friday", "thanks for the quote").
 * Counts only, never content.
 */
export type ChatterKind = 'media' | 'deleted' | 'sticker' | 'system' | 'short_reply';
export interface ChatterResult { kept: ImportedMessage[]; removed: number; total: number; byKind: Record<ChatterKind, number> }

const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const MEDIA_LINE = /^(?:<\s*media\s+omitted\s*>|\[media omitted\]|(?:image|video|audio|gif|document|contact card) omitted|<\s*attached:[^>]*>|\S+\.(?:jpe?g|png|webp|heic|gif|mp4|mov|3gp|opus|ogg|m4a|mp3|aac|pdf|docx?|xlsx?|pptx?|vcf|zip)(?:\s*\(file attached\))?)$/i;
const STICKER_LINE = /^(?:<\s*sticker omitted\s*>|sticker omitted)$/i;
const DELETED = /^(?:this message was deleted|you deleted this message)\.?$/i;
const SYSTEM = /^(?:missed (?:group )?(?:voice|video) call|messages and calls are end-to-end encrypted\b.*|waiting for this message\b.*|null|you blocked this contact\.?|you unblocked this contact\.?)$/i;
// A lone acknowledgement: every word is one of these (at least one that is not "you"/"u"), plus emoji/punctuation.
const ACK_WORD = /^(?:ok+|okay+|okey|okie|k+|thanks|thank|thx|thnx|ty|tq|you|u|lol+|(?:ha){2,}h?|(?:he){2,}|lmao)$/i;
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3/gu;

export function chatterKind(m: ImportedMessage): ChatterKind | null {
  const body = (m.body ?? '').replace(INVISIBLE, '').trim();
  if (!body) return 'system';
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => STICKER_LINE.test(l))) return 'sticker';
  if (lines.every((l) => MEDIA_LINE.test(l))) return 'media';
  if (lines.length !== 1) return null;
  const line = lines[0]!;
  if (DELETED.test(line)) return 'deleted';
  if (SYSTEM.test(line)) return 'system';
  const words = line.replace(EMOJI, ' ').replace(/[!.,~]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'short_reply'; // emoji only
  if (words.every((w) => ACK_WORD.test(w)) && words.some((w) => !/^(?:you|u)$/i.test(w))) return 'short_reply';
  return null;
}

export function filterChatter(messages: ImportedMessage[]): ChatterResult {
  const byKind: Record<ChatterKind, number> = { media: 0, deleted: 0, sticker: 0, system: 0, short_reply: 0 };
  const kept: ImportedMessage[] = [];
  for (const m of messages) {
    const k = chatterKind(m);
    if (k) byKind[k] += 1;
    else kept.push(m);
  }
  return { kept, removed: messages.length - kept.length, total: messages.length, byKind };
}
