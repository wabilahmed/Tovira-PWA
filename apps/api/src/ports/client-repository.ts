/**
 * Port: the per-rep client list (the first tenant-scoped table). Every method is
 * scoped to a userId; the Postgres implementation additionally enforces this at
 * the DB via Row-Level Security (P0-4).
 */

export interface ClientRecord {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  /** Recency signal for fast selection — bumped on create and on activity. */
  lastTouchedAt: number;
}

export interface ClientRepository {
  create(userId: string, name: string): Promise<ClientRecord>;
  /** Most-recently-touched first. */
  listByUser(userId: string): Promise<ClientRecord[]>;
  /** Case-insensitive name search, most-recently-touched first. */
  search(userId: string, query: string): Promise<ClientRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<ClientRecord | null>;
  /** Bump a client's recency (e.g. when a note is filed under it). */
  touch(userId: string, id: string): Promise<void>;
}
