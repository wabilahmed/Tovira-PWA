/**
 * Port: the extraction OPERATIONAL log (P1-8). One row per extraction attempt, holding only what
 * operating the service needs — model id, prompt version, tokens, latency, outcome, and counts of facts
 * proposed/accepted/rejected-by-reason. [NO-TRAINING-RETENTION, 2026-10-02] It records NO conversation
 * content: no input text, no raw model output. The note's text already lives in `notes` and accepted
 * facts in `facts`, so the log needs none of it to be investigable. Still tenant-scoped (operational
 * per-user data).
 */

/** [NO-TRAINING-RETENTION] Why a proposed fact did not reach the vault — a fixed, extensible set of COUNT
 *  keys, never free text. Derivation: the deterministic write-time drops the extractor applies — `health`
 *  (dropSensitivePersonalFacts), `date_invariant` (a due date before the note's reference date, nulled +
 *  dropped to low), `held_for_confirmation` (low-confidence / Ask-capture held out of the vault). */
export type RejectionReason = 'health' | 'date_invariant' | 'held_for_confirmation';

export interface ExtractionLogEntry {
  noteId: string;
  promptVersion: string;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Prompt-cache usage (CACHE-TRACK). A call that WROTE the cache has
   *  cacheCreationTokens > 0; one that READ it has cacheReadTokens > 0. Both 0
   *  when the provider doesn't cache (stub/local). Drives the tier advisor. */
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** [NO-TRAINING-RETENTION] Fact-quality counts (metadata, no content). `factsProposed` = facts the
   *  model emitted; `factsAccepted` = facts stored; `rejectedByReason` = per-reason counts of proposed
   *  facts that did not reach the vault; `factsRejected` is their sum. A count is enough to monitor
   *  quality; content is not needed. */
  factsProposed: number;
  factsAccepted: number;
  factsRejected: number;
  rejectedByReason: Partial<Record<RejectionReason, number>>;
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
  /**
   * [CORRECTIONS-WIRE] Stamp the OUTCOME onto a note's surviving log row(s) (e.g. 'rejected' when
   * an Ask-captured statement is rejected). Before this, a rejected ask-capture row kept
   * status='pending_confirmation' forever and was indistinguishable from one still awaiting
   * confirmation — retained but unlabelled. Call BEFORE deleting the note (0045 nulls note_id on
   * delete, breaking the lookup). Tenant-scoped. Returns rows updated.
   */
  labelOutcomeByNote(userId: string, noteId: string, status: string): Promise<number>;
}
