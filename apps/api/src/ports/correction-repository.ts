/**
 * Port: rep corrections (P2-3) — the highest-value training data. When a rep
 * fixes an extracted fact we record before/after so a future model can learn to
 * be BETTER than the base model, not just cheaper. PII → tenant-scoped.
 */

export interface CorrectionEntry {
  noteId: string;
  entityType: string; // e.g. 'promise'
  entityId: string;
  field: string; // e.g. 'text', 'owner', 'due_date'
  before: string | null;
  after: string | null;
  // The prompt version that produced the original extraction (P7-2). Ties each
  // correction to the exact prompt that made the mistake — the key to training a
  // better model later. null when the source extraction wasn't logged; NEVER a
  // fabricated version (a wrong fact is worse than a missing one).
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
  /** [TRAINING-ARCHIVE] This tenant's correction rows created strictly before `cutoffMs`, oldest
   *  first — archival candidates. No delete-by-age exists; rows leave only via deleteByIds after a
   *  confirmed archive write. */
  listOlderThan(userId: string, cutoffMs: number): Promise<CorrectionRecord[]>;
  /** [TRAINING-ARCHIVE] Remove exactly these rows (already archived + verified). Tenant-scoped. */
  deleteByIds(userId: string, ids: string[]): Promise<number>;
}
