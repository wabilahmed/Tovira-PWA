import type { ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { asExtraction } from './validate.js';
import type { Extraction } from './types.js';

export interface ExtractOutcome {
  status: string;
  flagged?: boolean;
}

/**
 * Turn a note's raw text into structured facts (P1-6). The prompt is [cacheable
 * prefix] → [variable message with today's date]. On malformed/invalid output we
 * retry ONCE, then flag the note for review and write NOTHING structured — a
 * wrong fact is worse than a missing one, and a partial write is worse still.
 */
export class ExtractionService {
  constructor(
    private readonly model: ModelClient,
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly embedder: Embedder,
  ) {}

  async extractNote(userId: string, noteId: string, today: string): Promise<ExtractOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { status: 'not_found' };
    if (!note.rawText || !note.rawText.trim()) return { status: note.status };

    const client = await this.clients.findByIdForUser(userId, note.clientId);
    const userMessage = buildUserMessage({
      today,
      clientName: client?.name ?? 'Unknown',
      source: note.source,
      text: note.rawText,
    });

    // Try once, then retry once on malformed/invalid output.
    let extraction = await this.callAndValidate(userMessage);
    if (!extraction) extraction = await this.callAndValidate(userMessage);

    if (!extraction) {
      // Never write partial structured data — just flag for the rep to review.
      await this.notes.update(userId, noteId, { status: 'needs_review' });
      return { status: 'needs_review', flagged: true };
    }

    // Store: full facts → JSONB, promises → spine, raw text → embedding.
    const embedding = await this.embedder.embed(note.rawText);
    await this.notes.update(userId, noteId, { extracted: extraction, status: 'extracted', embedding });
    await this.facts.saveExtraction(userId, {
      noteId,
      clientId: note.clientId,
      promises: extraction.promises,
    });
    return { status: 'extracted' };
  }

  private async callAndValidate(userMessage: string): Promise<Extraction | null> {
    let text: string;
    try {
      const res = await this.model.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 2048,
      });
      text = res.text;
    } catch {
      return null; // model/transport error → treat as a failed attempt
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null; // malformed JSON → failed attempt
    }
    return asExtraction(parsed); // schema-invalid → null (failed attempt)
  }
}
