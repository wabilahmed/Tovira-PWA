import type { ClientRepository } from '../../ports/client-repository.js';
import type { ContactAliasRepository } from '../../ports/contact-alias-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { PersonLinkRepository } from '../../ports/person-link-repository.js';
import type { Restriction } from '../erasure/restriction.js';
import { NO_RESTRICTION } from '../erasure/restriction.js';
import { foldKey, sharesAWord } from '../extraction/counterpart.js';
import { reattributeRenamedClient } from './live-names.js';
import { factWithholder } from '../erasure/surface-filter.js';

export interface SamePersonCard {
  id: string;
  clientId: string;
  clientName: string;
  noteId: string | null;
  personName: string;
  quote: string | null;
  quoteAt: string | null;
  question: string;
}

type Person = { name?: string | null; source_span?: string | null; source_message_at?: string | null };

/**
 * [P50-2 · owner] Tovira never guesses whether two names are one person. A person who only shares a word with the client's
 * name or an alias (so the exact-name fold left them apart) becomes one Needs your answer card: "Is 'Khalid' in this chat
 * the same person as Khalid Al Mansoori?". Same person folds their entries into the client and keeps the name as a
 * rep-confirmed alias (exact match, like every alias); Different person keeps them apart, and the pair is never asked
 * about again. Until answered, they are their own entry, never merged. A restricted person never shows in a card.
 */
export class SamePersonService {
  constructor(private readonly deps: {
    links: PersonLinkRepository;
    clients: Pick<ClientRepository, 'findByIdForUser' | 'listByUser'>;
    notes: Pick<NoteRepository, 'listByClient' | 'update'>;
    aliases?: Pick<ContactAliasRepository, 'listByClient' | 'add'>;
    restriction?: { forUser(userId: string): Promise<Restriction> };
  }) {}

  /** After a chat's extraction: ask about each unfolded person who shares a word with the client. Returns how many new. */
  async noteLookalikes(userId: string, clientId: string, noteId: string | null, extraction: { people?: Person[] }): Promise<number> {
    const client = await this.deps.clients.findByIdForUser(userId, clientId);
    if (!client) return 0;
    const aliases = this.deps.aliases ? await this.deps.aliases.listByClient(userId, clientId) : [];
    const self = foldKey(client.name);
    let asked = 0;
    for (const p of extraction.people ?? []) {
      const name = (p.name ?? '').trim();
      if (!name || foldKey(name) === self || !sharesAWord(name, client.name, aliases)) continue;
      const added = await this.deps.links.askOnce(userId, { clientId, noteId, personName: name, personKey: foldKey(name), quote: p.source_span ?? null, quoteAt: p.source_message_at ?? null });
      if (added) asked += 1;
    }
    return asked;
  }

  async list(userId: string): Promise<SamePersonCard[]> {
    const pending = await this.deps.links.listPending(userId);
    if (pending.length === 0) return [];
    const r = this.deps.restriction ? await this.deps.restriction.forUser(userId) : NO_RESTRICTION;
    const names = new Map((await this.deps.clients.listByUser(userId)).map((c) => [c.id, c.name]));
    // [TASK 2] the receipt may be the restricted person's own message without naming them: withheld like any fact read from them
    const withheld = await factWithholder(userId, this.deps.restriction, this.deps.notes, (id) => names.get(id));
    const out: SamePersonCard[] = [];
    for (const q of pending) {
      const clientName = names.get(q.clientId);
      if (!clientName) continue;
      if (r.active && (r.restrictsWho(q.personName) || r.restrictsWho(clientName) || r.restrictsText(q.quote) || (await withheld({ clientId: q.clientId, noteId: q.noteId, quote: q.quote })))) continue; // [TASK 2]
      out.push({ id: q.id, clientId: q.clientId, clientName, noteId: q.noteId, personName: q.personName, quote: q.quote, quoteAt: q.quoteAt, question: `Is '${q.personName}' in this chat the same person as ${clientName}?` });
    }
    return out;
  }

  async answer(userId: string, id: string, answer: 'same' | 'different'): Promise<boolean> {
    const q = await this.deps.links.findById(userId, id);
    if (!q || q.status !== 'pending') return false;
    const client = await this.deps.clients.findByIdForUser(userId, q.clientId);
    if (!client) return false;
    if (!(await this.list(userId)).some((c) => c.id === id)) return false; // a card the rep can't see can't be answered
    if (!(await this.deps.links.answer(userId, id, answer, Date.now()))) return false;
    if (answer === 'same') {
      await reattributeRenamedClient(this.deps.notes, userId, q.clientId, q.personName, client.name);
      if (this.deps.aliases) await this.deps.aliases.add(userId, q.clientId, q.personName, 'rep_confirmed');
    }
    return true;
  }
}
