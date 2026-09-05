import type { Confidence } from '../services/extraction/types.js';

/**
 * Port: the requirements spine (INV-MATCH). Extraction writes what a client has STATED they are
 * looking for as first-class rows — like the promises/key_dates spine — so requirements have
 * identity (for idempotent match dismissals), their OWN embedding (precise matching, not a blended
 * note vector — §4 precision over everything), and lifecycle state (§11.1: open → met, or dormant
 * after 60 days without mention). Tenant-scoped; the pg impl enforces isolation at the DB via RLS +
 * composite (user_id, client_id) FKs.
 */
export type RequirementStatus = 'open' | 'met' | 'dormant';

export interface RequirementRecord {
  id: string;
  userId: string;
  noteId: string;
  clientId: string;
  text: string;
  requirementRaw: string;
  statedOn: string | null;
  confidence: Confidence;
  status: RequirementStatus;
  /** Vector presence only — the raw embedding never leaves the repo (mirrors inventory). */
  embedded: boolean;
  /** Last time this need was mentioned — drives the 60-day dormancy (§11.1). */
  lastMentionedAt: number;
  createdAt: number;
}

export interface RequirementInput {
  text: string;
  requirementRaw: string;
  statedOn: string | null;
  confidence: Confidence;
  /** Per-requirement embedding (Titan, one call each — never a per-pairing model call). Null if the
   *  embedder failed; matching simply skips a requirement with no vector (best-effort, never blocks). */
  embedding: number[] | null;
}

export interface SimilarRequirement {
  requirement: RequirementRecord;
  similarity: number; // cosine in [-1, 1]
}

export interface RequirementRepository {
  /** Idempotent per note: replace this note's requirement rows with the given set (like
   *  saveExtraction). Returns the stored rows (with ids) so the caller can trigger matching. */
  saveForNote(userId: string, noteId: string, clientId: string, reqs: RequirementInput[]): Promise<RequirementRecord[]>;
  listByClient(userId: string, clientId: string): Promise<RequirementRecord[]>;
  /** Open, non-dormant requirements across the rep — the matchable set for a new inventory item. */
  listOpenByUser(userId: string): Promise<RequirementRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<RequirementRecord | null>;
  setStatus(userId: string, id: string, status: RequirementStatus): Promise<void>;
  /** Bump last-mention (resets the dormancy clock) when the client raises the need again. */
  markMentioned(userId: string, id: string, at: number): Promise<void>;
  /** Open requirements whose vector is nearest the query (an inventory item's vector) — the
   *  reverse match direction. Vector cosine only, no model call. */
  searchByEmbedding(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarRequirement[]>;
  /** Move open requirements not mentioned since `cutoffMs` to dormant (§11.1). Returns the count. */
  markDormantBefore(userId: string, cutoffMs: number): Promise<number>;
  /** NOTE-MOVE: re-file a note's requirements under another client (the vector/text is unchanged, so
   *  their matches stay valid — only the client attribution moves). Returns the reassigned ids so
   *  the caller can move their matches too. */
  reassignByNote(userId: string, noteId: string, toClientId: string): Promise<string[]>;
  /** IMPORT-UNDO: delete a note's requirements. Returns the removed ids (their matches follow). */
  deleteByNote(userId: string, noteId: string): Promise<string[]>;
  purgeUser(userId: string): Promise<void>;
}
