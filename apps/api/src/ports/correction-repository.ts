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
