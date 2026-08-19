/**
 * Port: the extraction training log (P1-8). Every extraction attempt is logged —
 * input, raw model output, model id, prompt version, tokens, latency — so we can
 * later train a self-hosted model and analyse failures. It is PII, so it is
 * tenant-scoped like every other user table.
 */

export interface ExtractionLogEntry {
  noteId: string;
  promptVersion: string;
  model: string;
  input: string;
  rawOutput: string | null;
  status: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Prompt-cache usage (CACHE-TRACK). A call that WROTE the cache has
   *  cacheCreationTokens > 0; one that READ it has cacheReadTokens > 0. Both 0
   *  when the provider doesn't cache (stub/local). Drives the tier advisor. */
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ExtractionLogRecord extends ExtractionLogEntry {
  id: string;
  userId: string;
  createdAt: number;
}

export interface ExtractionLogRepository {
  log(userId: string, entry: ExtractionLogEntry): Promise<void>;
  listByUser(userId: string): Promise<ExtractionLogRecord[]>;
  /**
   * The prompt version of the most recent logged extraction for a note (P7-2) —
   * used to stamp corrections with the prompt that produced the fact. Tenant-
   * scoped. Returns null if the note has no logged extraction.
   */
  findPromptVersionByNote(userId: string, noteId: string): Promise<string | null>;
}
