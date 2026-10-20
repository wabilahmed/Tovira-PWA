import type { ImportedMessage, NoteRecord } from '../../ports/note-repository.js';

/**
 * [P35-3] The source of a receipt, as WhatsApp-style bubbles — shared by every surface that shows a receipt.
 *
 * Given the stored note and what the fact recorded about its source (the verbatim span and the message time),
 * find the message it came from and return it plus up to 3 messages either side, each with its sender and its
 * SIDE from the import's rep identification ('rep' = the rep's own message). The side is never guessed: in a
 * chat where the import never identified the rep (an unnamed group), everyone is on the other side, named.
 * A voice note is one rep-side "Voice note" bubble (the transcript excerpt); a pasted / typed / Ask note is one
 * rep-side "Your note" bubble. Text is exactly as stored — redaction unchanged. Held (excluded) messages never
 * appear. Nothing here reads anything but the stored note.
 */
export type BubbleSide = 'rep' | 'other';

export interface Bubble {
  sender: string;
  side: BubbleSide;
  /** "YYYY-MM-DDTHH:MM" (a chat message) or "YYYY-MM-DD" (a note's date); null when unknown. */
  at: string | null;
  text: string;
  /** The message the fact came from. */
  source: boolean;
  voice?: boolean;
}

export interface ReceiptSource {
  kind: 'chat' | 'voice' | 'note' | 'quote';
  noteId: string | null;
  /** False for a chat where the import never identified the rep — everyone is on the other side. */
  repKnown: boolean;
  /** The source message and up to 3 either side (chat), or the single note bubble. */
  bubbles: Bubble[];
  /** More messages exist beyond the window ("Show full conversation"). */
  hasMore: boolean;
}

export interface ReceiptRef {
  noteId?: string | null;
  clientId?: string | null;
  /** The stored verbatim span the fact was drawn from. */
  span?: string | null;
  /** The source message time (or the note's date). */
  at?: string | null;
  /** Fallback text when there is no note to look in. */
  quote?: string | null;
  /** Fallback sender name for a quote-only bubble. */
  sender?: string | null;
}

export const CONTEXT = 3;

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const minute = (at: string | null | undefined): string | null => (at ? at.trim().slice(0, 16) : null);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Index of the message a fact came from: the one containing its span (the message time breaks a tie), else the
 *  one at that minute, else the one sharing the span's opening words; -1 when none. */
export function locateMessage(messages: ImportedMessage[], span: string | null | undefined, at: string | null | undefined): number {
  const want = span ? squash(span) : '';
  const atMin = minute(at);
  if (want) {
    const hits = messages.map((m, i) => ({ m, i })).filter(({ m }) => squash(m.body).includes(want));
    if (hits.length === 1) return hits[0]!.i;
    if (hits.length > 1) return (atMin ? hits.find(({ m }) => minute(m.sentAt) === atMin) : undefined)?.i ?? hits[0]!.i;
  }
  if (atMin) {
    const i = messages.findIndex((m) => minute(m.sentAt) === atMin);
    if (i >= 0) return i;
  }
  if (want.length >= 12) {
    const head = want.slice(0, 24);
    const i = messages.findIndex((m) => squash(m.body).includes(head));
    if (i >= 0) return i;
  }
  return -1;
}

type NoteLike = Pick<NoteRecord, 'id' | 'source' | 'messages' | 'rawText' | 'createdAt'>;

function noteBubble(note: NoteLike, ref: ReceiptRef): ReceiptSource {
  const voice = note.source === 'voice';
  const raw = (note.rawText ?? '').trim();
  const span = ref.span?.trim() ?? '';
  // The span is the part the fact came from — show it when it is really in the note; else the note itself.
  const text = span && squash(raw).includes(squash(span)) ? span : raw || span || (ref.quote ?? '').trim();
  return {
    kind: voice ? 'voice' : 'note',
    noteId: note.id,
    repKnown: true,
    bubbles: [{ sender: voice ? 'Voice note' : 'Your note', side: 'rep', at: ref.at ?? dayOf(note.createdAt), text, source: true, ...(voice ? { voice: true } : {}) }],
    hasMore: false,
  };
}

function window(note: NoteLike, ref: ReceiptRef, size: number | 'full'): ReceiptSource {
  const shown = (note.messages ?? []).filter((m) => !m.excluded);
  if (shown.length === 0) return noteBubble(note, ref);
  const repKnown = shown.some((m) => m.role === 'rep');
  let i = locateMessage(shown, ref.span, ref.at);
  if (i < 0) i = shown.length - 1; // no trace of the source → the latest message, never an invented one
  const from = size === 'full' ? 0 : Math.max(0, i - size);
  const to = size === 'full' ? shown.length : Math.min(shown.length, i + size + 1);
  const bubbles: Bubble[] = shown.slice(from, to).map((m, k) => ({
    sender: m.sender,
    side: repKnown && m.role === 'rep' ? 'rep' : 'other',
    at: m.sentAt,
    text: m.body,
    source: from + k === i,
  }));
  return { kind: 'chat', noteId: note.id, repKnown, bubbles, hasMore: from > 0 || to < shown.length };
}

/** The source message and up to 3 either side — what every receipt surface gets. */
export function sourceFromNote(note: NoteLike, ref: ReceiptRef): ReceiptSource {
  return window(note, ref, CONTEXT);
}

/** The thread for "Show full conversation" ('full'), or a window of `size` either side. */
export function threadFromNote(note: NoteLike, ref: ReceiptRef, size: number | 'full'): ReceiptSource {
  return window(note, ref, size);
}

/** [P36-5] A conversation read like WhatsApp: the `limit` messages before index `before` (default: the end),
 *  oldest-to-newest, nothing outlined. `from` is the index of the first one — the next older page is
 *  `before: from`. A voice note / pasted message is its one bubble. */
export function conversationPage(note: NoteLike, before: number | undefined, limit: number): { source: ReceiptSource; from: number } {
  const shown = (note.messages ?? []).filter((m) => !m.excluded);
  if (shown.length === 0) {
    const one = noteBubble(note, {});
    return { source: { ...one, bubbles: one.bubbles.map((b) => ({ ...b, source: false })) }, from: 0 };
  }
  const repKnown = shown.some((m) => m.role === 'rep');
  const to = Math.max(0, Math.min(shown.length, before ?? shown.length));
  const from = Math.max(0, to - Math.max(1, limit));
  const bubbles: Bubble[] = shown.slice(from, to).map((m) => ({ sender: m.sender, side: repKnown && m.role === 'rep' ? 'rep' : 'other', at: m.sentAt, text: m.body, source: false }));
  return { source: { kind: 'chat', noteId: note.id, repKnown, bubbles, hasMore: from > 0 }, from };
}

/** No note to look in (a fact predating its note link): one bubble from the stored quote, named, never on the
 *  rep's side (we don't know who said it). */
export function quoteOnlySource(ref: ReceiptRef): ReceiptSource {
  return {
    kind: 'quote',
    noteId: null,
    repKnown: false,
    bubbles: [{ sender: ref.sender?.trim() || 'Source', side: 'other', at: ref.at ?? null, text: (ref.quote ?? ref.span ?? '').trim(), source: true }],
    hasMore: false,
  };
}
