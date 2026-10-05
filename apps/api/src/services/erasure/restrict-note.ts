import type { NoteRecord, ImportedMessage } from '../../ports/note-repository.js';
import type { Restriction } from './restriction.js';

/**
 * [TASK 2] Return a SURFACING VIEW of a note with restricted content withheld — the single transform
 * every read/model path applies after loading notes, so a restricted counterparty is held out of
 * extraction, briefs, answers, the daily list, pointers, search and alerts in one place.
 *
 * It mirrors the erasure "about vs mention" doctrine: it strips the restricted party's own MESSAGES and
 * the STRUCTURED who-fields about them (people[].name, personal_facts[].subject,
 * unanswered_questions[].sender); it leaves free-text that merely MENTIONS them (promises, concerns,
 * summaries) intact, exactly as the erasure keeps mentions. A note whose messages were ENTIRELY the
 * restricted party's loses its rendered text too (nothing left to send), and a message-free note (voice/
 * paste) that is ABOUT the restricted party has its raw text withheld whole.
 *
 * It never mutates the stored note — the real record is untouched (still stored, still exported). It
 * returns a shallow copy for consumers to read.
 */
export function restrictNote(note: NoteRecord, r: Restriction): NoteRecord {
  if (!r.active) return note;

  const hadMessages = (note.messages?.length ?? 0) > 0;
  const messages: ImportedMessage[] | null = note.messages
    ? note.messages.filter((m) => !r.restrictsWho(m.sender))
    : note.messages;
  const extracted = restrictExtracted(note.extracted, r);

  let rawText = note.rawText;
  if (hadMessages) {
    // A message note's rendered text is derived from its messages; when none survive, there is nothing
    // left to surface, so drop the stale raw concatenation too.
    if ((messages?.length ?? 0) === 0) rawText = null;
  } else if (noteIsAboutRestricted(note, r)) {
    // A message-free note (voice/paste) that is about the restricted party is withheld whole.
    rawText = null;
  }

  return { ...note, messages, extracted, rawText };
}

/** True if the note (its messages or its structured who-fields) is about a restricted counterparty. */
export function noteIsAboutRestricted(note: NoteRecord, r: Restriction): boolean {
  if (!r.active) return false;
  if ((note.messages ?? []).some((m) => r.restrictsWho(m.sender))) return true;
  const ex = note.extracted;
  if (!ex || typeof ex !== 'object') return false;
  const e = ex as Record<string, unknown>;
  const whoIn = (arr: unknown, key: string): boolean =>
    Array.isArray(arr) && arr.some((x) => r.restrictsWho((x as Record<string, unknown>)?.[key] as string | undefined));
  return whoIn(e.people, 'name') || whoIn(e.personal_facts, 'subject') || whoIn(e.unanswered_questions, 'sender');
}

/** Remove the restricted party's structured who-field entries; keep every other field untouched. */
function restrictExtracted(extracted: unknown, r: Restriction): unknown {
  if (!extracted || typeof extracted !== 'object') return extracted;
  const e = extracted as Record<string, unknown>;
  const dropBy = (arr: unknown, key: string): unknown =>
    Array.isArray(arr) ? arr.filter((x) => !r.restrictsWho((x as Record<string, unknown>)?.[key] as string | undefined)) : arr;
  return {
    ...e,
    people: dropBy(e.people, 'name'),
    personal_facts: dropBy(e.personal_facts, 'subject'),
    unanswered_questions: dropBy(e.unanswered_questions, 'sender'),
  };
}
