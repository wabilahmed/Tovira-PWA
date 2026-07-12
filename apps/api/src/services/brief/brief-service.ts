import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository, PromiseRecord } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { Extraction, ExtractedPerson, PersonalFact } from '../extraction/types.js';
import { presentableAsSettledFact, promiseNeedsConfirmation } from '../facts/confirmation.js';

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
  openPromises: PromiseRecord[]; // settled/certain only
  needsConfirmation: PromiseRecord[]; // uncertain — shown as "to confirm", never as fact
  keyPeople: ExtractedPerson[];
  personalNotes: PersonalFact[];
  concerns: string[];
  relatedNotes: RelatedNote[];
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
  ) {}

  async buildBrief(userId: string, clientId: string): Promise<Brief | null> {
    const client = await this.clients.findByIdForUser(userId, clientId);
    if (!client) return null;

    const notes = await this.notes.listByClient(userId, clientId); // newest-first
    const promises = (await this.facts.listPromisesByUser(userId)).filter(
      (p) => p.clientId === clientId && !p.done,
    );

    const openPromises = promises.filter(presentableAsSettledFact);
    const needsConfirmation = promises.filter(promiseNeedsConfirmation);

    const extracted = notes.map((n) => extractedOf(n.extracted));
    const keyPeople = dedupePeople(extracted.flatMap((f) => f.people));
    const personalNotes = extracted.flatMap((f) => f.personal_facts);
    const concerns = extracted.flatMap((f) => f.concerns);

    const recentContext: RecentItem[] = notes.slice(0, 5).map((n) => ({
      noteId: n.id,
      source: n.source,
      status: n.status,
      summary: extractedOf(n.extracted).summary,
      createdAt: n.createdAt,
    }));

    const relatedNotes = await this.related(userId, clientId, notes);

    const empty = notes.length === 0 && promises.length === 0;
    return {
      clientName: client.name,
      empty,
      recentContext,
      openPromises,
      needsConfirmation,
      keyPeople,
      personalNotes,
      concerns,
      relatedNotes,
    };
  }

  private async related(
    userId: string,
    clientId: string,
    notes: Array<{ id: string; rawText: string | null }>,
  ): Promise<RelatedNote[]> {
    const focus = notes.find((n) => n.rawText && n.rawText.trim());
    if (!focus?.rawText) return [];
    const query = await this.embedder.embed(focus.rawText);
    const sims = await this.notes.searchSimilar(userId, clientId, query, 5);
    return sims
      .filter((s) => s.note.id !== focus.id && s.similarity >= RELATED_THRESHOLD)
      .map((s) => ({ noteId: s.note.id, snippet: (s.note.rawText ?? '').slice(0, 140), similarity: s.similarity }));
  }
}

function dedupePeople(people: ExtractedPerson[]): ExtractedPerson[] {
  const seen = new Map<string, ExtractedPerson>();
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
