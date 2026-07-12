/**
 * Port: captured notes (the "messy pile"). Tenant-scoped; the Postgres impl
 * enforces isolation at the DB via RLS.
 */

export type NoteSource = 'voice' | 'paste';

export interface NoteRecord {
  id: string;
  userId: string;
  clientId: string;
  source: NoteSource;
  rawText: string | null;
  audioKey: string | null;
  status: string;
  extracted: unknown | null;
  createdAt: number;
}

export interface NewNote {
  clientId: string;
  source: NoteSource;
  rawText: string | null;
  audioKey: string | null;
  status: string;
}

export interface NotePatch {
  rawText?: string | null;
  status?: string;
  extracted?: unknown | null;
  embedding?: number[] | null;
}

export interface SimilarNote {
  note: NoteRecord;
  similarity: number; // cosine similarity in [-1, 1]
}

export interface NoteRepository {
  create(userId: string, note: NewNote): Promise<NoteRecord>;
  listByClient(userId: string, clientId: string): Promise<NoteRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<NoteRecord | null>;
  update(userId: string, id: string, patch: NotePatch): Promise<void>;
  /** Semantic search over a client's notes by embedding similarity. */
  searchSimilar(userId: string, clientId: string, queryEmbedding: number[], limit: number): Promise<SimilarNote[]>;
}
