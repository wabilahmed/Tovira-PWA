import type { Industry } from './access-request-repository.js';
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

/** [LEAD-STATUS] The rep's MANUAL pipeline label for a client. NULL (not in this union) = "Unsorted",
 *  the default for every new/imported client. Set ONLY by the rep — never by extraction, import, the
 *  going-cold signals, pointers or the retrospective. Distinct from `outcome` (how a deal ended). */
export type LeadStatus = 'warm' | 'cold' | 'done';

/** [OUTCOME-FOLLOWUP-2] One append-only record of a single outcome transition. `source` is the ACTOR
 *  of THIS transition ('rep' or 'inferred'), not necessarily the client's resulting outcome_source —
 *  e.g. a rep tapping "still open" on an inferred loss logs {lost_inferred → open, source:'rep'} while
 *  the client's stored outcome_source returns to null. That distinction is exactly what lets a later
 *  analysis tell a rep-revival from an activity-revival. */
export interface OutcomeTransition {
  clientId: string;
  previous: ClientOutcome;
  next: ClientOutcome;
  source: OutcomeSource;
  changedAt: number;
}

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
  /** [P57-3] Optional company, as the rep typed it; null when not given. */
  company?: string | null;
  /** [P57-3] Optional industry, from the sign-up form's list (access-request Industry); null when not given. */
  industry?: Industry | null;
  createdAt: number;
  /** Recency signal for fast selection — bumped on create and on activity. */
  lastTouchedAt: number;
  /** [OUTCOME] Deal outcome; defaults to 'open'. */
  outcome: ClientOutcome;
  /** [OUTCOME] When the outcome last changed; null while it is the untouched default. */
  outcomeChangedAt: number | null;
  /** [OUTCOME] Who set the current outcome; null while untouched. */
  outcomeSource: OutcomeSource | null;
  /** [LEAD-STATUS] The rep's manual pipeline label; null = Unsorted (the default). Only a rep changes it. */
  leadStatus: LeadStatus | null;
  /** [LEAD-STATUS] When the rep last changed lead_status; null while it is the untouched default. */
  leadStatusChangedAt: number | null;
}

export interface ClientRepository {
  create(userId: string, name: string, phone?: string | null, title?: string | null, email?: string | null, extra?: { company?: string | null; industry?: Industry | null }): Promise<ClientRecord>;
  /** Set (or clear) a client's phone. Scoped to the owner; a no-op otherwise. */
  setPhone(userId: string, id: string, phone: string | null): Promise<void>;
  /** [P58-P2] Set (or clear) a client's company and industry. Scoped to the owner; a no-op otherwise. */
  setDetails(userId: string, id: string, details: { company: string | null; industry: Industry | null }): Promise<void>;
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
   *  a no-op for a foreign/unknown client (RLS is the hard net in Postgres). [FOLLOWUP-2] Appends an
   *  outcome-history row when the outcome or source actually changes (a no-op write logs nothing). */
  setOutcome(userId: string, id: string, outcome: ClientOutcome, source: OutcomeSource, changedAtMs: number): Promise<void>;
  /** [OUTCOME] Revert a client to the untouched default (outcome 'open', no source, no changed-at).
   *  Used for a rep "still open" snooze (actor 'rep') and by the silence rule to clear an inferred loss
   *  when activity resumes (actor 'inferred'). Scoped to the owner. [FOLLOWUP-2] `actor` is recorded as
   *  the transition's source in the history; the client's outcome_source still returns to null. Appends
   *  a history row only when it actually changes the outcome (already-open/untouched → no row). */
  clearOutcome(userId: string, id: string, actor: OutcomeSource, changedAtMs: number): Promise<void>;
  /** [OUTCOME-FOLLOWUP-2] The append-only outcome-transition history for one client, oldest first.
   *  Scoped to the owner — another rep's history is never returned. */
  listOutcomeHistory(userId: string, id: string): Promise<OutcomeTransition[]>;
  /** [LEAD-STATUS] Set (or clear → null = Unsorted) a client's MANUAL pipeline label, recording when.
   *  Scoped to the owner; a no-op for a foreign/unknown client (RLS is the hard net in Postgres).
   *  Only ever called from the rep-tap route — nothing automatic calls this. */
  setLeadStatus(userId: string, id: string, status: LeadStatus | null, changedAtMs: number): Promise<void>;
  /** [P49] Rename a client and record the change (old, new, when) in one step. Returns the old name, or null for a
   *  foreign/unknown client (nothing changed). The same name again changes nothing and records nothing. */
  rename(userId: string, id: string, name: string, changedAtMs: number): Promise<{ oldName: string } | null>;
  /** [P49] Every rename of one client, oldest first. Scoped to the owner. */
  listNameHistory(userId: string, id: string): Promise<NameChange[]>;
  /** [P49] Every rename across the rep's clients, oldest first (one read, for surfaces that hold an old copy). */
  listRenamesByUser(userId: string): Promise<Array<NameChange & { clientId: string }>>;
}

/** [P49] One rename, as recorded. */
export interface NameChange { oldName: string; newName: string; changedAt: number }
