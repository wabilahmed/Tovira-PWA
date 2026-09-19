/**
 * Port: the erasure audit log (single-counterparty erasure, Privacy Policy §10 / Terms 4.9). Records
 * THAT an erasure happened — when, for whom (the request subject, needed to run the Terms-4.9
 * retention window and to prove the request was honoured), and WHAT CATEGORIES were affected with
 * counts — but NEVER the erased content itself (no fact text, no quotes, no message bodies).
 * Tenant-scoped like every other user table.
 */

export interface ErasureCategoryCount {
  category: string; // e.g. 'people' | 'personal_facts' | 'messages' | 'unanswered_questions' | 'training_logs' | 'flagged_facts'
  deleted: number;
}

export interface ErasureAuditEntry {
  /** The requester's name(s) as supplied at intake — request metadata (not erased content); needed
   *  for the retention window and to answer "was X erased?". */
  requesterNames: string[];
  /** Category → count of rows/entries deleted. No content, only shape. */
  categories: ErasureCategoryCount[];
  /** 'previewed' when the operator ran a preview; 'committed' when the erasure was executed. */
  outcome: 'committed';
}

export interface ErasureAuditRecord extends ErasureAuditEntry {
  id: string;
  userId: string;
  at: number;
}

export interface ErasureAuditRepository {
  record(userId: string, entry: ErasureAuditEntry): Promise<ErasureAuditRecord>;
  listByUser(userId: string): Promise<ErasureAuditRecord[]>;
}
