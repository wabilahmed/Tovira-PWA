/**
 * Port: rep verdicts on extracted facts (P2-3) — OPERATIONAL verdict metadata, NOT training content.
 * [NO-TRAINING-RETENTION, 2026-10-02] When a rep confirms, rejects, or edits an extracted fact we record
 * WHICH fact, the VERDICT, and (for edits) the KIND of correction — never the before/after text. The
 * corrected fact itself lives in `facts`; a rep's term corrections feed the operational `rep_glossary`
 * (and the before/after is discarded there). PII-free by construction, still tenant-scoped.
 */

/** The kind of verdict. A rep's action on an extracted fact is one of these; it drives the rejection-rate
 *  monitor and the precision figure (confirms ÷ confirms+rejects). Replaces the former __confirmed__ /
 *  __rejected__ sentinel fields. */
export type Verdict = 'confirm' | 'reject' | 'edit';
export const VERDICTS: readonly Verdict[] = ['confirm', 'reject', 'edit'];

/** For reject + edit only (NULL for confirm): the kind of correction. A fixed enum, never free text.
 *  reject → should_not_exist; edits infer it from the field (date field → date_wrong; person reassignment
 *  → wrong_person; added-a-missed-fact → missing; else → wrong_value). */
export type CorrectionKind = 'wrong_value' | 'wrong_person' | 'should_not_exist' | 'date_wrong' | 'missing';
export const CORRECTION_KINDS: readonly CorrectionKind[] = ['wrong_value', 'wrong_person', 'should_not_exist', 'date_wrong', 'missing'];

export interface CorrectionEntry {
  noteId: string;
  entityType: string; // e.g. 'promise'
  entityId: string;
  field: string; // the fact field edited (e.g. 'text', 'owner', 'due_date'); '' for a whole-fact verdict
  /** [NO-TRAINING-RETENTION] the rep's verdict. */
  verdict: Verdict;
  /** [NO-TRAINING-RETENTION] reject/edit only; NULL for confirm. The DB enforces this with a check. */
  correctionKind: CorrectionKind | null;
  /** [NO-TRAINING-RETENTION] date corrections ONLY: corrected date minus original date, in whole days,
   *  computed at correction time before the before/after values are discarded. Null otherwise. */
  dateDeltaDays: number | null;
  // The prompt version that produced the original extraction (P7-2). Ties the verdict to the prompt that
  // made the fact. null when the source extraction wasn't logged; NEVER a fabricated version.
  promptVersion: string | null;
}

export interface CorrectionRecord extends CorrectionEntry {
  id: string;
  userId: string;
  createdAt: number;
}

export interface CorrectionRepository {
  record(userId: string, entry: CorrectionEntry): Promise<void>;
  listByUser(userId: string): Promise<CorrectionRecord[]>;
}
