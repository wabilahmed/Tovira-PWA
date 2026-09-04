import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [MISFILE-DETECT] Deterministic misfile detection at import time — before any model call.
 *
 * A WhatsApp export names its participants, so if a rep files Ahmed's chat under Meridian we can
 * often tell from the transcript alone. We compare the transcript's participants against the
 * selected client (its name, its known people from the stakeholder map, and — strongest — its
 * stored phone) and, when they don't match, against the rep's OTHER clients to suggest the right one.
 *
 * Doctrine (spec, same as meetings/card-scan): CONFIRM, never block; SUGGEST, never auto-reassign.
 * And bias against nagging: on a first import (no known people, no phone) we cannot check, so we
 * stay silent rather than cry misfile at every new client.
 */
export interface ClientIdentity {
  id: string;
  name: string;
  phone: string | null;
}

export interface MisfileInput {
  messages: ImportedMessage[];
  selected: ClientIdentity;
  /** Names on the selected client's stakeholder map (extracted people across their notes). */
  knownPeople: string[];
  /** The rep's other clients (each with their own known people), to suggest the right one. */
  others: Array<ClientIdentity & { knownPeople: string[] }>;
}

export type MisfileDetection =
  | { status: 'ok' }
  | { status: 'mismatch'; counterparts: string[]; suggestion: { id: string; name: string } | null };

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A participant token that is just a phone number (unsaved contact) — digits, +, spaces, dashes. */
function isPhone(sender: string): boolean {
  const digits = sender.replace(/[^0-9]/g, '');
  return digits.length >= 7 && /^[+0-9()\-\s]+$/.test(sender.trim());
}

/** Two phone numbers match on their last 8 significant digits (ignores country-code formatting). */
function phonesMatch(a: string, b: string): boolean {
  const da = a.replace(/[^0-9]/g, '');
  const db = b.replace(/[^0-9]/g, '');
  if (da.length < 7 || db.length < 7) return false;
  const n = Math.min(8, da.length, db.length);
  return da.slice(-n) === db.slice(-n);
}

/** Significant word tokens of a name (≥3 chars) — so "Sarah Lee" and "Sarah" share `sarah`, but a
 *  2-letter token like "Me" never spuriously lands inside "Meridian". */
function words(name: string): Set<string> {
  return new Set(norm(name).split(' ').filter((w) => w.length >= 3));
}

/** Does a name match another — exact, or sharing a significant word (whole-word, not substring)? */
function nameMatches(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wb = words(b);
  for (const w of words(a)) if (wb.has(w)) return true;
  return false;
}

// The device owner's own messages carry a self-label, never a counterpart's identity.
const SELF_LABELS = new Set(['me', 'you']);

/** Distinct participant identities in the transcript (sender names + phone-number senders),
 *  excluding the rep's own self-label. */
function participantsOf(messages: ImportedMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    const s = m.sender.trim();
    if (!s || SELF_LABELS.has(norm(s))) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Does any participant match this client — by phone (strongest), name, or a known person? */
function clientMatched(participants: string[], client: ClientIdentity, knownPeople: string[]): boolean {
  for (const p of participants) {
    if (isPhone(p)) {
      if (client.phone && phonesMatch(p, client.phone)) return true;
      continue; // a phone that doesn't match this client's phone is not a name signal
    }
    if (nameMatches(p, client.name)) return true;
    if (knownPeople.some((kp) => nameMatches(p, kp))) return true;
  }
  return false;
}

export function detectMisfileAtImport(input: MisfileInput): MisfileDetection {
  const participants = participantsOf(input.messages);
  if (participants.length === 0) return { status: 'ok' }; // nothing to check

  // Filed correctly if any participant matches the selected client.
  if (clientMatched(participants, input.selected, input.knownPeople)) return { status: 'ok' };

  const counterparts = participants.filter((p) => !isPhone(p));

  // Does the transcript positively match one of the rep's OTHER clients? That's the strongest
  // misfile signal and gives us a suggestion — regardless of whether the selected client had
  // identity to check (so it catches the first import too).
  const matchedOthers = input.others.filter((c) => clientMatched(participants, c, c.knownPeople));
  if (matchedOthers.length === 1) {
    return { status: 'mismatch', counterparts, suggestion: { id: matchedOthers[0]!.id, name: matchedOthers[0]!.name } };
  }
  if (matchedOthers.length > 1) {
    return { status: 'mismatch', counterparts, suggestion: null }; // matches several — ambiguous
  }

  // No other client matched. Only raise an (ambiguous) prompt when we actually HAD something to
  // check the selected client against and it failed — a stored phone or a known-people map. On a
  // fresh client with neither, we cannot tell, so we do not nag.
  const hadIdentity = input.selected.phone !== null || input.knownPeople.length > 0;
  if (hadIdentity) return { status: 'mismatch', counterparts, suggestion: null };

  return { status: 'ok' };
}

/**
 * [MISFILE-POST] Softer, content-only misfile detection AFTER extraction — for voice notes and
 * pastes, which carry no participant metadata. The only signal is who the note mentions.
 *
 * Conservative by design: over-flagging trains the rep to ignore the queue. We flag ONLY when a
 * note filed under B mentions people who are on ANOTHER client's record and NONE who are on B's —
 * zero overlap with the filed client (spec), not merely a better match elsewhere. Deterministic:
 * extracted people vs known people, no model call, no prompt change.
 */
export interface PostMisfileInput {
  /** People names extracted from THIS note. */
  notePeople: string[];
  filedClient: { id: string; name: string };
  /** People on the filed client's record from their OTHER notes (never this note's own). */
  filedClientOtherPeople: string[];
  /** The rep's other clients with the people on their records. */
  others: Array<{ id: string; name: string; people: string[] }>;
}

export type PostMisfileResult =
  | { status: 'ok' }
  | { status: 'suggest_move'; to: { id: string; name: string } | null; mentioned: string[]; reason: string };

const anyNameMatch = (names: string[], pool: string[]): boolean => names.some((n) => pool.some((p) => nameMatches(n, p)));

export function detectMisfilePostExtraction(input: PostMisfileInput): PostMisfileResult {
  const people = input.notePeople.map((p) => p.trim()).filter(Boolean);
  if (people.length === 0) return { status: 'ok' }; // nothing to reason from

  // Any overlap with the filed client → correctly filed (the conservative gate).
  if (anyNameMatch(people, input.filedClientOtherPeople)) return { status: 'ok' };

  // Zero overlap with B. Only flag if the mentions positively land on another client A.
  const matched = input.others.filter((c) => anyNameMatch(people, c.people));
  if (matched.length === 0) return { status: 'ok' };

  const to = matched.length === 1 ? { id: matched[0]!.id, name: matched[0]!.name } : null;
  const mentioned = people.filter((n) => matched.some((c) => c.people.some((p) => nameMatches(n, p))));
  const whose = to ? `${to.name}'s` : `another client's`;
  const list = mentioned.length ? mentioned.join(' and ') : 'people';
  return { status: 'suggest_move', to, mentioned, reason: `This note mentions ${list}, who are on ${whose} record. Move it?` };
}
