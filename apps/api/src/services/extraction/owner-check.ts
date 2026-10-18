/**
 * [P25-1] Write-time OWNER check — deterministic, no prompt change.
 *
 * The most common "fabricated" promise is an OWNER FLIP: the rep's "I'll confirm the PO Friday" saved as
 * the client's (then it matches no expected promise). After extraction and before saving, each promise's
 * receipt (verbatim source_span + source_message_at) is traced back to its source message; when that
 * message is found UNIQUELY and the span is a FIRST-PERSON commitment, the owner is whoever SENT it:
 *  - an imported chat: the rep's message → rep; the client's message → client;
 *  - the rep's own voice/paste notes (no sender): a first-person commitment → rep.
 * It ONLY corrects `owner`. It never creates, deletes or rewrites a promise. Anything uncertain — no span,
 * a span found zero or several times, a third party ("Fatima will approve"), a group chat where the rep was
 * never identified — changes nothing.
 */
import type { Extraction, PromiseOwner } from './types.js';
import type { ImportedMessage, NoteSource } from '../../ports/note-repository.js';

export type OwnerRule = 'first_person_sender_rep' | 'first_person_sender_client' | 'first_person_rep_note';
export interface OwnerCorrection { index: number; from: PromiseOwner; to: PromiseOwner; rule: OwnerRule }

// English: I'll / I will / I'm (am) going to / I can send / let me (straight or curly apostrophe).
const EN_FIRST_PERSON = /\b(?:i['’]ll|i\s+will|i['’]m\s+going\s+to|i\s+am\s+going\s+to|i\s+can\s+send|let\s+me)\b/i;
// Arabic: سأ… (future prefix), سوف, راح, بأ…/بـ… (Gulf "I'll"), خليني. Word-initial only.
const AR_FIRST_PERSON = /(?:^|[\s،.,!؟:؛"'(])(?:سأ\p{L}+|سوف(?=\s)|راح(?=\s)|بأ\p{L}+|بـ\p{L}+|خليني)/u;

export function isFirstPersonCommitment(span: string): boolean {
  return EN_FIRST_PERSON.test(span) || AR_FIRST_PERSON.test(span);
}

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
/** The minute a message was sent ("YYYY-MM-DDTHH:MM"), for matching a receipt's source_message_at. */
const minute = (at: string | null | undefined): string | null => (at ? at.trim().slice(0, 16) : null);

function occurrences(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

export interface OwnerCheckContext {
  source: NoteSource;
  /** An imported chat's model-visible messages, with speaker roles from the import. */
  messages?: ImportedMessage[] | null;
  /** The text the model saw (the rep's own words for voice/paste). */
  text?: string | null;
}

/** Correct promise owners in place; returns one entry per correction (for the log + counter). */
export function correctPromiseOwners(extraction: Extraction, ctx: OwnerCheckContext): OwnerCorrection[] {
  const fixes: OwnerCorrection[] = [];
  const chat = ctx.source === 'whatsapp_export';
  const repNote = ctx.source === 'voice' || ctx.source === 'paste';
  if (!chat && !repNote) return fixes;
  const messages = (ctx.messages ?? []).filter((m) => !m.excluded);
  // A chat where the import never identified the rep (e.g. a group chat) → no basis to attribute anything.
  if (chat && !messages.some((m) => m.role === 'rep')) return fixes;
  const text = repNote ? squash(ctx.text ?? '') : '';

  extraction.promises.forEach((p, index) => {
    const span = p.source_span ? squash(p.source_span) : '';
    if (!span || !isFirstPersonCommitment(p.source_span!)) return;
    let to: PromiseOwner | null = null;
    let rule: OwnerRule | null = null;
    if (chat) {
      let candidates = messages.filter((m) => squash(m.body).includes(span));
      const at = minute(p.source_message_at);
      if (at && candidates.length > 1) candidates = candidates.filter((m) => minute(m.sentAt) === at);
      if (candidates.length !== 1) return; // not found uniquely → change nothing
      const sender = candidates[0]!.role;
      if (sender === 'rep') { to = 'rep'; rule = 'first_person_sender_rep'; }
      else if (sender === 'client') { to = 'client'; rule = 'first_person_sender_client'; }
      else return; // speaker unknown → change nothing
    } else {
      if (occurrences(text, span) !== 1) return; // not found uniquely in the rep's own note
      to = 'rep';
      rule = 'first_person_rep_note';
    }
    if (to && rule && p.owner !== to) {
      fixes.push({ index, from: p.owner, to, rule });
      p.owner = to;
    }
  });
  return fixes;
}

let corrections = 0;
/** Running total of owner corrections since boot (logged with each correction). */
export function ownerCorrectionCount(): number {
  return corrections;
}
/** Log each correction as ONE line — promise position, old → new owner, the rule. No message text. */
export function logOwnerCorrections(noteId: string, fixes: OwnerCorrection[], log: (line: string) => void = (l) => console.info(l)): void {
  for (const f of fixes) {
    corrections += 1;
    log(`[owner-check] note=${noteId} promise#${f.index} ${f.from}→${f.to} rule=${f.rule} total=${corrections}`);
  }
}
