import type { NoteRecord } from '../../ports/note-repository.js';
import type { RequirementRecord } from '../../ports/requirement-repository.js';
import type { KeyDateRecord } from '../../ports/facts-repository.js';
import type { PersonalFact } from '../extraction/types.js';
import { isSensitiveFact } from '../extraction/health-filter.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';

/**
 * [P69 · owner] "What they care about": what the client has told the rep about themselves, read from the
 * stored record. No model call, nothing inferred. Three kinds, in this order:
 *  - detail: a personal fact ("Loves the beach, goes every morning before work"), with its verbatim source;
 *  - date:   a date of theirs still ahead or with no date yet ("Board meeting · the 14th"), as they said it;
 *  - ask:    an open requirement ("A property that allows pets"), with the client's own words;
 *  - worry:  a concern they raised ("Worried the premium will jump again next year"), from the chat it came from.
 * The P69 probe found half of what clients care about lands as an ask or a worry, not a personal fact, so all
 * three are shown together. Tovira states what the client said; it adds no advice.
 */
export type CareKind = 'detail' | 'date' | 'ask' | 'worry';
export interface CareItem {
  kind: CareKind;
  text: string;
  /** Who it is about, only when that is someone other than the client (e.g. "Layla" at Marina Estates). */
  subject: string | null;
  noteId: string;
  /** The verbatim words it came from; null for a worry (concerns store no quote) or a fact saved before receipts. */
  quote: string | null;
  /** When it was said ("YYYY-MM-DDTHH:MM" for a chat message, a date for an ask), or null. */
  at: string | null;
}

/** Worries are only read from the client's most recent conversations: an old concern may be long settled. */
export const WORRY_NOTES = 3;

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The client themselves: their name, or its first word ("Layla" for client "Layla Haddad"). */
function isClient(subject: string, clientName: string): boolean {
  const s = norm(subject);
  const c = norm(clientName);
  return s === '' || s === c || s === c.split(' ')[0];
}

function extractedOf(n: NoteRecord): { personal_facts: PersonalFact[]; concerns: string[] } {
  const e = (n.extracted && typeof n.extracted === 'object' ? n.extracted : {}) as { personal_facts?: unknown; concerns?: unknown };
  return {
    personal_facts: Array.isArray(e.personal_facts) ? (e.personal_facts as PersonalFact[]) : [],
    concerns: Array.isArray(e.concerns) ? (e.concerns as unknown[]).filter((c): c is string => typeof c === 'string') : [],
  };
}

export function caresAbout(input: {
  clientName: string;
  /** The client's notes, newest first (as listByClient returns them). */
  notes: NoteRecord[];
  requirements: RequirementRecord[];
  /** The client's key dates (birthday, anniversary, deadline…); past ones are left out. */
  keyDates?: KeyDateRecord[];
  restriction?: Restriction;
  nowMs?: number;
}): CareItem[] {
  const r = input.restriction ?? NO_RESTRICTION;
  if (r.active && r.restrictsWho(input.clientName)) return [];
  const notes = r.active ? input.notes.map((n) => restrictNote(n, r)) : input.notes;
  const seen = new Set<string>();
  const fresh = (text: string): boolean => {
    const k = norm(text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const hidden = (text: string | null | undefined): boolean => r.active && r.restrictsText(text);

  const details: CareItem[] = [];
  for (const n of notes) {
    for (const f of extractedOf(n).personal_facts) {
      if (typeof f?.fact !== 'string' || isSensitiveFact(f) || hidden(f.fact) || !fresh(f.fact)) continue;
      const subject = typeof f.subject === 'string' && !isClient(f.subject, input.clientName) ? f.subject : null;
      details.push({ kind: 'detail', text: f.fact, subject, noteId: n.id, quote: f.source_span?.trim() ? f.source_span : null, at: f.source_message_at ?? null });
    }
  }

  // [P69] A date of theirs, shown as they said it ("the 14th", "in May"): never a guessed day. Past dates drop off.
  const today = new Date(input.nowMs ?? Date.now()).toISOString().slice(0, 10);
  const dates: CareItem[] = (input.keyDates ?? [])
    .filter((d) => typeof d.description === 'string' && d.description.trim() && (d.date === null || d.date >= today) && !hidden(d.description))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
    .filter((d) => fresh(d.description))
    .map((d) => {
      const when = d.dateRaw?.trim() || d.date;
      return { kind: 'date' as const, text: when && !norm(d.description).includes(norm(when)) ? `${d.description} · ${when}` : d.description, subject: null, noteId: d.noteId, quote: d.sourceSpan?.trim() ? d.sourceSpan : null, at: d.sourceMessageAt };
    });

  const asks: CareItem[] = input.requirements
    .filter((q) => q.status === 'open' && !hidden(q.text) && !hidden(q.requirementRaw))
    .sort((a, b) => b.lastMentionedAt - a.lastMentionedAt)
    .filter((q) => fresh(q.text))
    .map((q) => ({ kind: 'ask' as const, text: q.text, subject: null, noteId: q.noteId, quote: q.requirementRaw?.trim() ? q.requirementRaw : null, at: q.statedOn }));

  const worries: CareItem[] = [];
  for (const n of notes.slice(0, WORRY_NOTES)) {
    for (const c of extractedOf(n).concerns) {
      if (hidden(c) || !fresh(c)) continue;
      worries.push({ kind: 'worry', text: c, subject: null, noteId: n.id, quote: null, at: null });
    }
  }
  return [...details, ...dates, ...asks, ...worries];
}

/** The one line a reminder or the Today list shows: the newest personal detail, else the next date, else an ask, else a worry. */
export function topCare(items: CareItem[]): string | null {
  const first = items[0];
  if (!first) return null;
  return first.subject ? `${first.subject}: ${first.text}` : first.text;
}
