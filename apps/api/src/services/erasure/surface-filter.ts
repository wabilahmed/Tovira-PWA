import type { NoteRecord, NoteRepository } from '../../ports/note-repository.js';
import { restrictNote } from './restrict-note.js';
import { NO_RESTRICTION, type Restriction } from './restriction.js';

/**
 * [P40-2] The erasure restriction for every rep-facing read, in one place.
 *
 *  - `restrictingNotes(notes, restriction)` — a notes view whose reads come back through restrictNote: the
 *    restricted person's messages and who-fields (people, personal facts, unanswered questions) are gone. A
 *    surfacing service (Book Scan, the Monday Statement, insights, the client page) reads notes through it; the
 *    stored note is untouched (the export and the erasure itself read the real repository).
 *  - `factWithholder(...)` — a fact (promise, requirement, meeting) READ FROM the restricted person is withheld:
 *    its receipt quote is one of their messages, or names them, or the client itself is them. A fact that merely
 *    mentions them in the rep's own words is kept, by the existing "about vs mention" rule.
 */
export interface RestrictionSource { forUser(userId: string): Promise<Restriction> }

/** A view of `repo` with some methods replaced; every other method runs on the real repo (`this` = repo), so a
 *  write through the view lands in the one real store. */
function overlay<T extends object>(repo: T, overrides: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return (overrides as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export function restrictingNotes<T extends Pick<NoteRepository, 'listByClient'> & Partial<Pick<NoteRepository, 'findByIdForUser'>>>(notes: T, restriction?: RestrictionSource): T {
  if (!restriction) return notes;
  const overrides: Record<string, unknown> = {
    listByClient: async (userId: string, clientId: string) => {
      const r = await restriction.forUser(userId);
      const list = await notes.listByClient(userId, clientId);
      return r.active ? list.map((n) => restrictNote(n, r)) : list;
    },
  };
  if (notes.findByIdForUser) {
    overrides.findByIdForUser = async (userId: string, id: string) => {
      const r = await restriction.forUser(userId);
      const n = await notes.findByIdForUser!(userId, id);
      return n && r.active ? restrictNote(n, r) : n;
    };
  }
  return overlay(notes, overrides as Partial<Record<keyof T, unknown>>);
}

export interface WithheldFact { clientId: string; noteId: string | null; quote: string | null | undefined }

/** A per-request check: is this fact the restricted person's? Notes are read lazily, only while a restriction is active. */
export async function factWithholder(
  userId: string,
  restriction: RestrictionSource | undefined,
  notes: Pick<NoteRepository, 'listByClient'>,
  clientName: (clientId: string) => string | null | undefined,
): Promise<(f: WithheldFact) => Promise<boolean>> {
  const r = restriction ? await restriction.forUser(userId) : NO_RESTRICTION;
  const theirs = new Map<string, Array<{ noteId: string; body: string }>>();
  return async (f) => {
    if (!r.active) return false;
    if (r.restrictsWho(clientName(f.clientId) ?? '')) return true;
    const quote = (f.quote ?? '').trim();
    if (!quote) return false;
    if (r.restrictsText(quote)) return true;
    if (!theirs.has(f.clientId)) {
      const list: Array<{ noteId: string; body: string }> = [];
      for (const n of await notes.listByClient(userId, f.clientId)) {
        for (const m of n.messages ?? []) if (r.restrictsWho(m.sender)) list.push({ noteId: n.id, body: m.body.trim().toLowerCase() });
      }
      theirs.set(f.clientId, list);
    }
    const q = quote.toLowerCase();
    return theirs.get(f.clientId)!.some((m) => (f.noteId === null || m.noteId === f.noteId) && m.body.length > 0 && (m.body.includes(q) || q.includes(m.body)));
  };
}

/** Keep only the facts the rep may see during the window. */
export async function withoutRestricted<T>(items: T[], isWithheld: (f: WithheldFact) => Promise<boolean>, fact: (t: T) => WithheldFact): Promise<T[]> {
  const out: T[] = [];
  for (const t of items) if (!(await isWithheld(fact(t)))) out.push(t);
  return out;
}

/** The note views a raw-note reader needs, typed for callers that only list. */
export type NoteLister = Pick<NoteRepository, 'listByClient'>;
export type { NoteRecord };

type Names = { listByUser(userId: string): Promise<Array<{ id: string; name: string }>> };
type Spanned = { clientId: string; noteId: string | null; sourceSpan: string | null };

/** A view whose list reads drop the facts read from the restricted person (see factWithholder). */
function viewDropping<T extends object>(repo: T, methods: Array<keyof T>, restriction: RestrictionSource | undefined, notes: NoteLister, clients: Names, fact: (x: never) => WithheldFact): T {
  if (!restriction) return repo;
  const overrides: Record<string, unknown> = {};
  for (const m of methods) {
    const orig = repo[m] as unknown as (userId: string, ...rest: unknown[]) => Promise<unknown[]>;
    if (typeof orig !== 'function') continue;
    overrides[m as string] = async (userId: string, ...rest: unknown[]) => {
      const list = await orig.call(repo, userId, ...rest);
      const r = await restriction.forUser(userId);
      if (!r.active) return list;
      const names = new Map((await clients.listByUser(userId)).map((c) => [c.id, c.name]));
      const withheld = await factWithholder(userId, restriction, notes, (id) => names.get(id));
      return withoutRestricted(list, withheld, fact as (x: unknown) => WithheldFact);
    };
  }
  return overlay(repo, overrides as Partial<Record<keyof T, unknown>>);
}

const spanned = (x: Spanned): WithheldFact => ({ clientId: x.clientId, noteId: x.noteId, quote: x.sourceSpan });

/** Promises and key dates read from the restricted person are withheld from every list read. */
export function restrictingFacts<T extends object>(facts: T, restriction: RestrictionSource | undefined, notes: NoteLister, clients: Names): T {
  return viewDropping(facts, ['listPromisesByUser', 'listPromisesByNote', 'listKeyDatesByUser', 'listKeyDatesByNote'] as Array<keyof T>, restriction, notes, clients, spanned as never);
}

/** Meetings read from the restricted person are withheld from every list read. */
export function restrictingMeetings<T extends object>(meetings: T, restriction: RestrictionSource | undefined, notes: NoteLister, clients: Names): T {
  return viewDropping(meetings, ['listByUser', 'listUnconfirmedByUser', 'dueForNudge'] as Array<keyof T>, restriction, notes, clients, spanned as never);
}

/** Requirements stated by the restricted person are withheld from every list read. */
export function restrictingRequirements<T extends object>(requirements: T, restriction: RestrictionSource | undefined, notes: NoteLister, clients: Names): T {
  return viewDropping(requirements, ['listOpenByUser', 'listByClient'] as Array<keyof T>, restriction, notes, clients,
    ((x: { clientId: string; noteId: string; requirementRaw: string; text: string }) => ({ clientId: x.clientId, noteId: x.noteId, quote: x.requirementRaw || x.text })) as never);
}

/** Everything a read-only surface needs, restricted. Writes, the export and the erasure itself use the real repos. */
export function surfacingRepos<N extends NoteLister, F extends object, M extends object, R extends object>(
  repos: { notes: N; facts: F; meetings: M; requirements: R; clients: Names },
  restriction: RestrictionSource | undefined,
): { notes: N; facts: F; meetings: M; requirements: R } {
  return {
    notes: restrictingNotes(repos.notes, restriction),
    facts: restrictingFacts(repos.facts, restriction, repos.notes, repos.clients),
    meetings: restrictingMeetings(repos.meetings, restriction, repos.notes, repos.clients),
    requirements: restrictingRequirements(repos.requirements, restriction, repos.notes, repos.clients),
  };
}
