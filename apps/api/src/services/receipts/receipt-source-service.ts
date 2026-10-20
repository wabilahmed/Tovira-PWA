import type { NoteRepository, NoteRecord } from '../../ports/note-repository.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import { sourceFromNote, threadFromNote, quoteOnlySource, conversationPage, type ReceiptRef, type ReceiptSource } from './receipt-source.js';

/**
 * [P35-3] Resolve receipt references to WhatsApp-style sources for one rep: by note id (the usual case), else
 * by client + span (a pointer's receipt), else a single quote bubble. Notes are read once per call (cached),
 * scoped to the rep (findByIdForUser / listByClient are tenant-bound), and the active erasure-window
 * restriction is applied before any message is shown.
 */
export const MAX_REFS = 60;

export class ReceiptSourceService {
  constructor(
    private readonly deps: {
      notes: Pick<NoteRepository, 'findByIdForUser' | 'listByClient'>;
      restriction?: { forUser(userId: string): Promise<Restriction> };
    },
  ) {}

  async resolve(userId: string, refs: ReceiptRef[]): Promise<ReceiptSource[]> {
    const restriction = this.deps.restriction ? await this.deps.restriction.forUser(userId) : NO_RESTRICTION;
    const byId = new Map<string, NoteRecord | null>();
    const byClient = new Map<string, NoteRecord[]>();
    const safe = (n: NoteRecord) => (restriction.active ? restrictNote(n, restriction) : n);
    const note = async (id: string) => {
      if (!byId.has(id)) byId.set(id, await this.deps.notes.findByIdForUser(userId, id).catch(() => null));
      const n = byId.get(id);
      return n ? safe(n) : null;
    };
    const clientNotes = async (clientId: string) => {
      if (!byClient.has(clientId)) byClient.set(clientId, (await this.deps.notes.listByClient(userId, clientId).catch(() => [])).map(safe));
      return byClient.get(clientId)!;
    };
    const out: ReceiptSource[] = [];
    for (const ref of refs.slice(0, MAX_REFS)) {
      let n: NoteRecord | null = ref.noteId ? await note(ref.noteId) : null;
      if (!n && ref.clientId && (ref.span || ref.quote)) {
        const want = (ref.span ?? ref.quote ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        n = (await clientNotes(ref.clientId)).find((x) => (x.messages ?? []).some((m) => !m.excluded && m.body.replace(/\s+/g, ' ').toLowerCase().includes(want)) || (x.rawText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(want)) ?? null;
      }
      out.push(n ? sourceFromNote(n, ref) : quoteOnlySource(ref));
    }
    return out;
  }

  /** The thread around a receipt: 3 either side, or the whole conversation ('full'). */
  async thread(userId: string, ref: ReceiptRef, size: 3 | 'full'): Promise<ReceiptSource> {
    const [first] = await this.resolve(userId, [ref]);
    if (!first || !first.noteId) return first ?? quoteOnlySource(ref);
    const restriction = this.deps.restriction ? await this.deps.restriction.forUser(userId) : NO_RESTRICTION;
    const n = await this.deps.notes.findByIdForUser(userId, first.noteId);
    if (!n) return first;
    return threadFromNote(restriction.active ? restrictNote(n, restriction) : n, ref, size);
  }

  /** [P36-5] One page of a whole conversation (newest first on screen; older pages on scroll-up), restricted. */
  async conversation(userId: string, noteId: string, before: number | undefined, limit: number): Promise<{ source: ReceiptSource; from: number } | null> {
    const n = await this.deps.notes.findByIdForUser(userId, noteId).catch(() => null);
    if (!n) return null;
    const restriction = this.deps.restriction ? await this.deps.restriction.forUser(userId) : NO_RESTRICTION;
    return conversationPage(restriction.active ? restrictNote(n, restriction) : n, before, Math.min(Math.max(1, limit), 200));
  }
}
