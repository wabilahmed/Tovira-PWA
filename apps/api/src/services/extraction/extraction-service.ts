import type { ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import { EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION, buildUserMessage } from './prompt.js';
import { asExtraction } from './validate.js';
import type { Extraction } from './types.js';

export interface ExtractOutcome {
  status: string;
  flagged?: boolean;
}

interface Attempt {
  parsed: unknown | null;
  raw: string | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Turn a note's raw text into structured facts (P1-6). The prompt is [cacheable
 * prefix] → [variable message with today's date]. On malformed/invalid output we
 * retry ONCE, then flag the note for review and write NOTHING structured. Every
 * extraction — success OR failure — writes exactly one training-log row (P1-8).
 */
export class ExtractionService {
  private readonly now = () => Date.now();

  constructor(
    private readonly model: ModelClient,
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly embedder: Embedder,
    private readonly logs: ExtractionLogRepository,
    /** Model id recorded in the log (e.g. 'stub' or 'claude-haiku-4-5-…'). */
    private readonly modelId: string = 'stub',
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

    const start = this.now();
    let last: Attempt = { parsed: null, raw: null, inputTokens: 0, outputTokens: 0 };
    let extraction: Extraction | null = null;
    for (let attempt = 0; attempt < 2 && !extraction; attempt++) {
      last = await this.call(userMessage);
      extraction = last.parsed ? asExtraction(last.parsed) : null;
    }

    let status: string;
    if (!extraction) {
      await this.notes.update(userId, noteId, { status: 'needs_review' });
      status = 'needs_review';
    } else {
      const embedding = await this.embedder.embed(note.rawText);
      await this.notes.update(userId, noteId, { extracted: extraction, status: 'extracted', embedding });
      await this.facts.saveExtraction(userId, {
        noteId,
        clientId: note.clientId,
        promises: extraction.promises,
        keyDates: extraction.key_dates,
      });
      status = 'extracted';
    }

    // Exactly one log row per extraction, success or failure.
    await this.logs.log(userId, {
      noteId,
      promptVersion: PROMPT_VERSION,
      model: this.modelId,
      input: userMessage,
      rawOutput: last.raw,
      status,
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
      latencyMs: this.now() - start,
    });

    return extraction ? { status } : { status, flagged: true };
  }

  private async call(userMessage: string): Promise<Attempt> {
    let raw: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const res = await this.model.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 2048,
      });
      raw = res.text;
      inputTokens = res.usage?.inputTokens ?? 0;
      outputTokens = res.usage?.outputTokens ?? 0;
    } catch {
      return { parsed: null, raw: null, inputTokens, outputTokens };
    }
    let parsed: unknown | null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    return { parsed, raw, inputTokens, outputTokens };
  }
}
