import type { ExtractedPromise, KeyDate } from '../services/extraction/types.js';

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
  doneAt: number | null;
  /** Whether the rep has confirmed this (uncertain items start unconfirmed). */
  confirmed: boolean;
  createdAt: number;
}

export interface KeyDateRecord {
  id: string;
  userId: string;
  noteId: string;
  clientId: string;
  description: string;
  date: string | null; // resolved YYYY-MM-DD, or null if unresolved
  dateRaw: string | null;
  type: string; // birthday | anniversary | launch | deadline | other
  createdAt: number;
}

export interface SaveExtractionInput {
  noteId: string;
  clientId: string;
  promises: ExtractedPromise[];
  keyDates?: KeyDate[];
}

export interface FactsRepository {
  /** Idempotent per note: replaces this note's spine rows with the given facts. */
  saveExtraction(userId: string, input: SaveExtractionInput): Promise<void>;
  listPromisesByUser(userId: string): Promise<PromiseRecord[]>;
  listPromisesByNote(userId: string, noteId: string): Promise<PromiseRecord[]>;
  /** Mark a promise confirmed by the rep. Returns false if not found/owned. */
  confirmPromise(userId: string, id: string): Promise<boolean>;
  getPromise(userId: string, id: string): Promise<PromiseRecord | null>;
  updatePromise(userId: string, id: string, patch: PromisePatch): Promise<boolean>;
  deletePromise(userId: string, id: string): Promise<boolean>;
  /** Mark a promise done (timestamped). Returns false if not found/owned. */
  markPromiseDone(userId: string, id: string): Promise<boolean>;
  listKeyDatesByUser(userId: string): Promise<KeyDateRecord[]>;
}

export interface PromisePatch {
  text?: string;
  owner?: string;
  dueDate?: string | null;
  dueRaw?: string | null;
  confidence?: string;
  done?: boolean;
}
