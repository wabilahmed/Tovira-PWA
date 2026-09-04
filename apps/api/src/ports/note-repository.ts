/**
 * Port: captured notes (the "messy pile"). Tenant-scoped; the Postgres impl
 * enforces isolation at the DB via RLS.
 */

export type NoteSource = 'voice' | 'paste' | 'whatsapp_export' | 'ask_conversation';

/** One speaker-attributed message from an imported chat export (P1-4b). */
export interface ImportedMessage {
  sentAt: string | null;
  sender: string;
  body: string;
  media: boolean;
  /** Resolved speaker role (P1-6). 'unknown' when we can't identify the client. */
  role: 'client' | 'rep' | 'unknown';
}

/** MISFILE-POST (B2): a soft, deterministic suggestion that this note may belong to another
 *  client (it mentions only people on that client's record). Surfaced in the confirmation queue;
 *  the rep decides. Null once acted on (moved) or when there is no suggestion. */
export interface MoveSuggestion {
  toClientId: string | null; // the single likely client, or null when several match
  toClientName: string | null;
  mentioned: string[]; // the people that pointed elsewhere
  reason: string;
  createdAt: number;
}

export interface NoteRecord {
  id: string;
  userId: string;
  clientId: string;
  source: NoteSource;
  rawText: string | null;
  audioKey: string | null;
  status: string;
  /** Server-sweep retry count (FLOWS-7); terminal needs_review after N. */
  sweepAttempts: number;
  extracted: unknown | null;
  messages: ImportedMessage[] | null;
  moveSuggestion?: MoveSuggestion | null;
  createdAt: number;
}

export interface NewNote {
  clientId: string;
  source: NoteSource;
  rawText: string | null;
  audioKey: string | null;
  status: string;
  messages?: ImportedMessage[] | null;
}

export interface NotePatch {
  sweepAttempts?: number;
  rawText?: string | null;
  status?: string;
  extracted?: unknown | null;
  embedding?: number[] | null;
  messages?: ImportedMessage[] | null;
  moveSuggestion?: MoveSuggestion | null;
  /** MISFILE / NOTE-MOVE (B3): re-file this note under another of the rep's clients. */
  clientId?: string;
}

export interface SimilarNote {
  note: NoteRecord;
  similarity: number; // cosine similarity in [-1, 1]
}

export interface NoteRepository {
  create(userId: string, note: NewNote): Promise<NoteRecord>;
  listByClient(userId: string, clientId: string): Promise<NoteRecord[]>;
  /** Notes still awaiting transcription/extraction, across ALL the rep's clients
   *  — the resume path so a pending note is never stuck if that client's screen
   *  is never reopened. */
  listPendingByUser(userId: string): Promise<NoteRecord[]>;
  /** Notes in a given status (e.g. 'pending_confirmation' for the Ask-capture queue), newest first. */
  listByStatusForUser(userId: string, status: string): Promise<NoteRecord[]>;
  /** MISFILE-POST (B2): notes across all the rep's clients that carry a pending move-suggestion. */
  listMoveSuggestionsByUser(userId: string): Promise<NoteRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<NoteRecord | null>;
  update(userId: string, id: string, patch: NotePatch): Promise<void>;
  /** Hard-delete a note (Ask-capture reject/expire). The training log survives (0045). */
  delete(userId: string, id: string): Promise<boolean>;
  /** Semantic search over a client's notes by embedding similarity. */
  searchSimilar(userId: string, clientId: string, queryEmbedding: number[], limit: number): Promise<SimilarNote[]>;
  /** Semantic search across ALL of the rep's notes — powers conversational recall (P4-8). */
  searchSimilarByUser(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarNote[]>;
}
