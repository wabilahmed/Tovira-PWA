import type { ExtractedPromise } from '../services/extraction/types.js';

/**
 * Port: the extracted "spine" — for now the promises table that drives the open
 * promises tracker (P4-1). Tenant-scoped; the Postgres impl enforces RLS.
 */

export interface PromiseRecord {
  id: string;
  userId: string;
  noteId: string;
  clientId: string;
  text: string;
  owner: string;
  dueDate: string | null;
  dueRaw: string | null;
  confidence: string;
  done: boolean;
  /** Whether the rep has confirmed this (uncertain items start unconfirmed). */
  confirmed: boolean;
  createdAt: number;
}

export interface SaveExtractionInput {
  noteId: string;
  clientId: string;
  promises: ExtractedPromise[];
}

export interface FactsRepository {
  /** Idempotent per note: replaces this note's spine rows with the given facts. */
  saveExtraction(userId: string, input: SaveExtractionInput): Promise<void>;
  listPromisesByUser(userId: string): Promise<PromiseRecord[]>;
  listPromisesByNote(userId: string, noteId: string): Promise<PromiseRecord[]>;
  /** Mark a promise confirmed by the rep. Returns false if not found/owned. */
  confirmPromise(userId: string, id: string): Promise<boolean>;
}
