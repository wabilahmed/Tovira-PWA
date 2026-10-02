/**
 * Port: the per-rep extraction glossary (P4-9) — OPERATIONAL user data, NOT a training store.
 *
 * [NO-TRAINING-RETENTION, 2026-10-02] A rep's own term corrections (wrong → right, e.g. a nickname they
 * keep fixing to the real name) are a private glossary injected into THAT rep's extraction calls to make
 * them more accurate. It never leaves their account, is deleted when they close it, and is purged for a
 * third party on erasure. It used to be reconstructed from the `corrections` before/after text; now that
 * conversation-derived text is not retained, the term pairs live here, as their own small operational
 * table — term-sized only (1–40 chars, DB-enforced), fed ONLY by edit corrections (never note text,
 * rejects, or confirms). Tenant-scoped like every user table.
 */

export interface RepGlossaryEntry {
  wrongTerm: string;
  rightTerm: string;
  timesCorrected: number;
  firstSeen: number;
  lastSeen: number;
}

export interface RepGlossaryRepository {
  /** Upsert a term pair for this rep: insert at times_corrected=1, or increment it and bump last_seen.
   *  Caller guarantees both terms are 1–40 chars and differ (the DB also enforces the length bound). */
  upsert(userId: string, wrongTerm: string, rightTerm: string, atMs: number): Promise<void>;
  /** Every glossary pair for this rep (buildGlossary applies the "corrected twice" threshold). */
  listByUser(userId: string): Promise<RepGlossaryEntry[]>;
  /** [ERASURE] Delete every row whose wrong_term OR right_term exactly matches one of these (normalised
   *  by the caller) terms — a third party's names/aliases. Returns rows removed. Tenant-scoped. */
  deleteByTerms(userId: string, terms: string[]): Promise<number>;
  /** Account deletion (explicit for in-memory; pg also cascades on the users FK). */
  purgeUser(userId: string): Promise<void>;
}
