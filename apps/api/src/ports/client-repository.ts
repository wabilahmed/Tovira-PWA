/**
 * Port: the per-rep client list (the first tenant-scoped table). Every method is
 * scoped to a userId; the Postgres implementation additionally enforces this at
 * the DB via Row-Level Security (P0-4).
 */

export interface ClientRecord {
  id: string;
  userId: string;
  name: string;
  /** Optional contact phone (P4-7), stored as the rep entered it — we never
   *  rewrite it or guess a country code. Null when unknown. */
  phone: string | null;
  /** Optional business-card fields (P4-5), stored verbatim; null otherwise. */
  title: string | null;
  email: string | null;
  createdAt: number;
  /** Recency signal for fast selection — bumped on create and on activity. */
  lastTouchedAt: number;
}

export interface ClientRepository {
  create(userId: string, name: string, phone?: string | null, title?: string | null, email?: string | null): Promise<ClientRecord>;
  /** Set (or clear) a client's phone. Scoped to the owner; a no-op otherwise. */
  setPhone(userId: string, id: string, phone: string | null): Promise<void>;
  /** Most-recently-touched first. */
  listByUser(userId: string): Promise<ClientRecord[]>;
  /** Case-insensitive name search, most-recently-touched first. */
  search(userId: string, query: string): Promise<ClientRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<ClientRecord | null>;
  /** Bump a client's recency (e.g. when a note is filed under it). */
  touch(userId: string, id: string): Promise<void>;
  /** NOTE-MOVE (B3): set a client's last-contact to a specific instant — used to RECOMPUTE the
   *  going-cold clock on both clients after a note moves (a misfile wrongly reset it). */
  setLastTouched(userId: string, id: string, ms: number): Promise<void>;
  /** Clients not touched since `cutoffMs` — the going-cold list. */
  listGoingCold(userId: string, cutoffMs: number): Promise<ClientRecord[]>;
}
