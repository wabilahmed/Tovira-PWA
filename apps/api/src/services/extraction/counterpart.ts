import { isPhone, phonesMatch } from '../import/misfile.js';

/**
 * [ALIAS-NORMALISE + CLIENT-PERSON v0.9.4 → P50-1 · owner] Fold the chat counterpart (this client, under their name, a
 * previous name or a learned alias) into the client's identity: the client IS a person, so they stay in people[] under
 * their REAL name, and a personal fact about them is re-subjected to it. If the model emitted both, one entry remains.
 *
 * A person folds ONLY on an exact full-name match, after normalising case, spacing and punctuation (foldKey). Never on a
 * shared word: "Khalid" is not "Khalid Al Mansoori", "Hills Properties" is not the client saved as "Ahmed Dubai Hills",
 * and merging two people is a zero rule. A phone number matches by number. A person who only shares a word with the
 * client is left as their own entry (the rep is asked: see sharesAWord).
 *
 * On NARROW_SURFACE (eval/extraction-fingerprint.ts): what it folds is what the gate scores. Mutates in place; never
 * touches receipts or raw text (evidence stays verbatim).
 */
export function normaliseCounterpart(
  extraction: { people?: Array<{ name?: string | null }>; personal_facts?: Array<{ subject?: string | null }> },
  clientName: string,
  aliases: string[],
  /** [P49-3] Previous names (the name a rename replaced). Exact, like every other name since P50. */
  previousNames: string[] = [],
): void {
  const names = [clientName, ...aliases, ...previousNames].filter((n) => !!n && n.trim());
  if (names.length === 0) return;
  const keys = new Set(names.filter((n) => !isPhone(n)).map(foldKey).filter(Boolean));
  const phones = names.filter((n) => isPhone(n));
  const isClient = (n: string | null | undefined): boolean => {
    if (!n || !n.trim()) return false;
    if (isPhone(n)) return phones.some((p) => phonesMatch(n, p));
    return keys.has(foldKey(n));
  };
  if (Array.isArray(extraction.people)) {
    const seen = new Set<string>();
    extraction.people = extraction.people
      .map((p) => (isClient(p.name) ? { ...p, name: clientName } : p)) // the client is a person: kept, under the REAL name
      .filter((p) => { const k = (p.name ?? '').trim().toLowerCase(); if (k === '') return true; if (seen.has(k)) return false; seen.add(k); return true; }); // an alias+real double → one
  }
  for (const f of extraction.personal_facts ?? []) {
    if (isClient(f.subject)) f.subject = clientName; // a fact about the alias is a fact about the client
  }
}

/** A name's comparison key: case-folded, punctuation as space, single spaces ("Khalid  Al-Mansoori!" = "khalid al mansoori"). */
export function foldKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Name particles and company words that say nothing about who someone is.
const NOT_A_NAME = new Set(['bin', 'bint', 'ibn', 'the', 'and', 'llc', 'ltd', 'inc', 'fze', 'fzco']);
const words = (name: string): Set<string> => new Set(foldKey(name).split(' ').filter((w) => w.length >= 3 && !NOT_A_NAME.has(w)));

/** [P50-2] An unfolded person who shares a word with the client's name or an alias: maybe the client, maybe not. Tovira
 *  never guesses; the rep is asked "Is X the same person as the client?". */
export function sharesAWord(person: string, clientName: string, aliases: string[]): boolean {
  if (!person.trim() || isPhone(person)) return false;
  const mine = words(person);
  return [clientName, ...aliases].some((n) => !isPhone(n) && [...words(n)].some((w) => mine.has(w)));
}
