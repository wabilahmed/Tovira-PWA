import type { Embedder } from '../../ports/embedder.js';
import type { NoteRepository, SimilarNote } from '../../ports/note-repository.js';
import type { ModelClient } from '../../ports/model.js';

/**
 * Conversational recall (P4-8): answer a rep's question from their own notes.
 * Trust rules under interrogation: every answer cites receipts (verbatim quote +
 * date from a stored note); when nothing relevant is retrieved the answer is an
 * honest "I don't have that" — never a fabrication. Retrieval is capped (top-k)
 * so a huge book never triggers an unbounded-context call (cost guard).
 */

export interface Receipt {
  quote: string;
  date: string;
  clientId: string;
  noteId: string;
}

export interface RecallAnswer {
  answer: string;
  receipts: Receipt[];
}

export interface RecallConfig {
  topK: number;
  minSimilarity: number;
}

const NO_ANSWER = "I don't have that on record.";
const MAX_QUOTE = 280;

const SYSTEM = `You answer a salesperson's question using ONLY the excerpts from their own notes provided below. Quote what was actually said and when. If the excerpts do not contain the answer, reply exactly "I don't have that on record." Never invent facts, names, dates, or commitments that are not in the excerpts.`;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toReceipt(m: SimilarNote): Receipt {
  const text = (m.note.rawText ?? '').trim();
  return {
    quote: text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text,
    date: isoDate(m.note.createdAt),
    clientId: m.note.clientId,
    noteId: m.note.id,
  };
}

export class RecallService {
  constructor(
    private readonly embedder: Embedder,
    private readonly notes: NoteRepository,
    private readonly model: ModelClient,
    private readonly config: RecallConfig = { topK: 5, minSimilarity: 0.2 },
  ) {}

  async ask(userId: string, question: string): Promise<RecallAnswer> {
    if (!question.trim()) return { answer: NO_ANSWER, receipts: [] };

    const embedding = await this.embedder.embed(question);
    const matches = await this.notes.searchSimilarByUser(userId, embedding, this.config.topK);
    const relevant = matches.filter((m) => m.similarity >= this.config.minSimilarity && (m.note.rawText ?? '').trim());
    if (relevant.length === 0) return { answer: NO_ANSWER, receipts: [] };

    const receipts = relevant.map(toReceipt);
    const excerpts = receipts.map((r, i) => `[${i + 1}] (${r.date}) ${r.quote}`).join('\n');
    let answer: string;
    try {
      const res = await this.model.complete({
        system: SYSTEM,
        messages: [{ role: 'user', content: `QUESTION: ${question}\n\nEXCERPTS:\n${excerpts}` }],
        maxTokens: 512,
      });
      answer = res.text.trim() || NO_ANSWER;
    } catch {
      // Never fabricate on a model failure — fall back to the verbatim receipts.
      answer = 'Here is what I found in your notes.';
    }
    return { answer, receipts };
  }
}
