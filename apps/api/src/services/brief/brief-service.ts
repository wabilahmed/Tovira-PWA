import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository, ImportedMessage } from '../../ports/note-repository.js';
import { modelSafeText } from '../import/dedup.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import type { NoteRecord } from '../../ports/note-repository.js';
import type { FactsRepository, PromiseRecord } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { Extraction, ExtractedPerson, PersonalFact, Pointer } from '../extraction/types.js';
import type { ClientPointerRepository } from '../../ports/client-pointer-repository.js';
import { presentableAsSettledFact, promiseNeedsConfirmation } from '../facts/confirmation.js';
import { withReceipt, withExtractedReceipt, type FactReceipt } from '../receipts/receipt.js';

const RELATED_THRESHOLD = 0.5;
const EMPTY: Extraction = {
  summary: '',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
};

export interface RecentItem {
  noteId: string;
  source: string;
  status: string;
  summary: string;
  createdAt: number;
}
export interface RelatedNote {
  noteId: string;
  snippet: string;
  similarity: number;
}
export interface Brief {
  clientName: string;
  empty: boolean;
  recentContext: RecentItem[];
  openPromises: Array<PromiseRecord & { receipt: FactReceipt }>; // settled/certain only
  needsConfirmation: Array<PromiseRecord & { receipt: FactReceipt }>; // uncertain — shown as "to confirm", never as fact
  keyPeople: Array<ExtractedPerson & { receipt: FactReceipt }>;
  personalNotes: Array<PersonalFact & { receipt: FactReceipt }>;
  concerns: string[];
  relatedNotes: RelatedNote[];
  /** [POINTERS · D9] the client's current pointers, the moment they matter most. Empty when none. */
  pointers: Pointer[];
  /** [D6] the exact retrospective disclosure, when the pointer set contains a retrospective. */
  pointersDisclosure: string | null;
}

function extractedOf(value: unknown): Extraction {
  if (value && typeof value === 'object') return { ...EMPTY, ...(value as Partial<Extraction>) };
  return EMPTY;
}

/**
 * Assemble the pre-meeting brief (P2-1) from the spine (promises), the JSONB
 * facts (people, concerns, personal notes) and semantic search over past notes.
 * Trust rules (P2-4): uncertain items are surfaced separately as "to confirm",
 * never as settled facts; an empty client yields an honest empty brief, never a
 * fabricated summary; the related-notes section is omitted when nothing is close.
 */
export class BriefService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly embedder: Embedder,
    /** [POINTERS · D9] the per-client pointer store; optional (older wiring omits it → no pointers). */
    private readonly pointers?: ClientPointerRepository,
    /** [TASK 2] Active erasure-window restriction — a restricted counterparty's facts, context and
     *  pointers are withheld from the brief. Absent → no restriction. */
    private readonly restriction?: { forUser(userId: string): Promise<Restriction> },
  ) {}

  async buildBrief(userId: string, clientId: string): Promise<Brief | null> {
    const client = await this.clients.findByIdForUser(userId, clientId);
    if (!client) return null;

    // [TASK 2] Withhold a restricted counterparty's content from the whole brief: each note is read
    // through the restriction view (its messages + structured facts stripped), and if the client itself
    // is the restricted party, its pointers are dropped entirely.
    const restriction = this.restriction ? await this.restriction.forUser(userId) : NO_RESTRICTION;
    const rawNotes = await this.notes.listByClient(userId, clientId); // newest-first
    const notes = restriction.active ? rawNotes.map((n) => restrictNote(n, restriction)) : rawNotes;
    const promises = (await this.facts.listPromisesByUser(userId)).filter(
      (p) => p.clientId === clientId && !p.done,
    );

    const openPromises = promises.filter(presentableAsSettledFact).map(withReceipt);
    const needsConfirmation = promises.filter(promiseNeedsConfirmation).map(withReceipt);

    const extracted = notes.map((n) => extractedOf(n.extracted));
    // People and personal facts carry no created_at of their own — bind each receipt's capture-date
    // fallback to the ORIGINATING note's created_at before deduping across notes.
    const keyPeople = dedupePeople(
      notes.flatMap((n) => extractedOf(n.extracted).people.map((p) => withExtractedReceipt(p, n.createdAt))),
    );
    const personalNotes = notes.flatMap((n) =>
      extractedOf(n.extracted).personal_facts.map((pf) => withExtractedReceipt(pf, n.createdAt)),
    );
    const concerns = extracted.flatMap((f) => f.concerns);

    const recentContext: RecentItem[] = notes.slice(0, 5).map((n) => ({
      noteId: n.id,
      source: n.source,
      status: n.status,
      summary: extractedOf(n.extracted).summary,
      createdAt: n.createdAt,
    }));

    const relatedNotes = await this.related(userId, clientId, notes, restriction);
    // [POINTERS · D9] the client's current pointers, shown at the moment they matter most.
    const pointerSet = this.pointers ? await this.pointers.getForClient(userId, clientId).catch(() => null) : null;
    // [TASK 2] Drop pointers that cite a restricted counterparty; if the CLIENT itself is the restricted
    // party, drop the whole set (the pointer card is a surface).
    const clientRestricted = restriction.active && restriction.restrictsWho(client.name);
    const visiblePointers = pointerSet && !clientRestricted
      ? pointerSet.pointers.filter((p) => !(restriction.active && restriction.restrictsText(p.text)))
      : [];

    const empty = rawNotes.length === 0 && promises.length === 0;
    return {
      clientName: client.name,
      empty,
      recentContext,
      openPromises,
      needsConfirmation,
      keyPeople,
      personalNotes,
      concerns,
      pointers: visiblePointers,
      pointersDisclosure: clientRestricted ? null : (pointerSet?.retrospectiveDisclosure ?? null),
      relatedNotes,
    };
  }

  private async related(
    userId: string,
    clientId: string,
    notes: Array<{ id: string; rawText: string | null; messages?: ImportedMessage[] | null }>,
    restriction: Restriction,
  ): Promise<RelatedNote[]> {
    // [SCREEN] The related-notes query embeds the focus note into Titan — a model send of third-party
    // content. Route it through modelSafeText so a held (flagged) message never reaches the embedder,
    // exactly like extraction, recall and draft. The caller already passes full notes (listByClient),
    // already restriction-filtered. [TASK 2] The SEARCH RESULTS are other notes loaded raw here, so
    // restrict them too — neither the embedded query nor a returned snippet may carry restricted content.
    const focus = notes.find((n) => modelSafeText(n).trim());
    if (!focus) return [];
    const query = await this.embedder.embed(userId, modelSafeText(focus));
    const sims = await this.notes.searchSimilar(userId, clientId, query, 5);
    if (!restriction.active) {
      return sims
        .filter((s) => s.note.id !== focus.id && s.similarity >= RELATED_THRESHOLD)
        .map((s) => ({ noteId: s.note.id, snippet: (s.note.rawText ?? '').slice(0, 140), similarity: s.similarity }));
    }
    return sims
      .map((s) => ({ ...s, note: restrictNote(s.note as NoteRecord, restriction) }))
      .filter((s) => s.note.id !== focus.id && s.similarity >= RELATED_THRESHOLD && modelSafeText(s.note).trim())
      .map((s) => ({ noteId: s.note.id, snippet: modelSafeText(s.note).slice(0, 140), similarity: s.similarity }));
  }
}

function dedupePeople<T extends ExtractedPerson>(people: T[]): T[] {
  const seen = new Map<string, T>();
  for (const p of people) {
    const key = (p.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    // Prefer the entry with a known decision role.
    if (!existing || (existing.decision_role === 'unknown' && p.decision_role !== 'unknown')) {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}
