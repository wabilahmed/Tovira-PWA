/**
 * Port: the per-rep client list (the first tenant-scoped table). Every method is
 * scoped to a userId; the Postgres implementation additionally enforces this at
 * the DB via Row-Level Security (P0-4).
 */

/** [OUTCOME] The deal outcome of a client relationship. 'open' is the default; a rep confirms
 *  'won' or 'lost_confirmed'; the nightly silence rule may set 'lost_inferred' (Task 3). Capture
 *  only — nothing in this batch analyses or aggregates these. */
export type ClientOutcome = 'open' | 'won' | 'lost_confirmed' | 'lost_inferred';
/** How the current outcome was arrived at. A later best-practices analysis MUST be able to tell a
 *  rep-confirmed loss from an inferred one (they may skew results differently), so this is stored
 *  explicitly rather than derived from the outcome value. Null while the outcome is the untouched
 *  default 'open'. */
export type OutcomeSource = 'rep' | 'inferred';

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
  /** [OUTCOME] Deal outcome; defaults to 'open'. */
  outcome: ClientOutcome;
  /** [OUTCOME] When the outcome last changed; null while it is the untouched default. */
  outcomeChangedAt: number | null;
  /** [OUTCOME] Who set the current outcome; null while untouched. */
  outcomeSource: OutcomeSource | null;
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
  /** [OUTCOME] Set a client's deal outcome, recording who set it and when. Scoped to the owner;
   *  a no-op for a foreign/unknown client (RLS is the hard net in Postgres). */
  setOutcome(userId: string, id: string, outcome: ClientOutcome, source: OutcomeSource, changedAtMs: number): Promise<void>;
}
