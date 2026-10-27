import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { norm } from '../import/misfile.js';

/**
 * [P49] A renamed client's name, current everywhere. A few surfaces hold a copy of the name from when they were written:
 * Today's precomputed list, an alert's text, a move suggestion. Those rows stay as they were stored; on the way out each
 * name the client used to have (from the rename history) is replaced by the one they have now, whole names only.
 * Stored messages and receipts never pass through here: a quote keeps the name it was said with.
 */
export interface LiveNames {
  /** The client's current name, or undefined for an unknown client. */
  name(clientId: string): string | undefined;
  /** `text` with every earlier name of this client replaced by the current one. */
  rewrite(clientId: string | null | undefined, text: string): string;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function liveNames(clients: Pick<ClientRepository, 'listByUser' | 'listRenamesByUser'>, userId: string): Promise<LiveNames> {
  const [list, renames] = await Promise.all([clients.listByUser(userId), clients.listRenamesByUser(userId)]);
  const current = new Map(list.map((c) => [c.id, c.name]));
  const earlier = new Map<string, RegExp>();
  const byClient = new Map<string, Set<string>>();
  for (const r of renames) {
    const set = byClient.get(r.clientId) ?? new Set<string>();
    set.add(r.oldName); set.add(r.newName);
    byClient.set(r.clientId, set);
  }
  for (const [clientId, names] of byClient) {
    const now = current.get(clientId);
    if (now === undefined) continue;
    const old = [...names].filter((n) => n !== now).sort((a, b) => b.length - a.length);
    // a whole name only: never inside a longer word ("Khalid" is not rewritten inside "Khalidiya")
    if (old.length) earlier.set(clientId, new RegExp(`(?<![\\p{L}\\p{N}])(?:${old.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu'));
  }
  return {
    name: (id) => current.get(id),
    rewrite: (id, text) => {
      const re = id ? earlier.get(id) : undefined;
      return re && text ? text.replace(re, current.get(id!)!) : text;
    },
  };
}

/**
 * [P49] On a rename: the client is folded into their chats' people under the name they had (extraction's attribution,
 * never the evidence). Re-attribute the people entries and personal-fact subjects that carry the old full name exactly to
 * the new one. Messages, raw text, receipts and every other field are untouched.
 */
export async function reattributeRenamedClient(notes: Pick<NoteRepository, 'listByClient' | 'update'>, userId: string, clientId: string, oldName: string, newName: string): Promise<number> {
  const target = norm(oldName);
  let changed = 0;
  for (const n of await notes.listByClient(userId, clientId)) {
    const ex = n.extracted as { people?: Array<{ name?: string | null }>; personal_facts?: Array<{ subject?: string | null }> } | null;
    if (!ex || typeof ex !== 'object') continue;
    let touched = false;
    const people = Array.isArray(ex.people) ? ex.people.map((p) => (p?.name && norm(p.name) === target ? (touched = true, { ...p, name: newName }) : p)) : ex.people;
    const facts = Array.isArray(ex.personal_facts) ? ex.personal_facts.map((f) => (f?.subject && norm(f.subject) === target ? (touched = true, { ...f, subject: newName }) : f)) : ex.personal_facts;
    if (!touched) continue;
    await notes.update(userId, n.id, { extracted: { ...ex, people, personal_facts: facts } });
    changed += 1;
  }
  return changed;
}
