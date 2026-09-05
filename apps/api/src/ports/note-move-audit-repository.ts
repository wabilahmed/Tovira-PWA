/**
 * Port: the audit trail for moving/undoing notes (B3/B4). A move rewrites which client owns a
 * note and everything derived from it; that must be RECORDED, not silent history-rewriting. Every
 * entry is tenant-scoped (RLS in Postgres).
 */
export interface NoteMoveCounts {
  messages: number;
  promises: number;
  keyDates: number;
  meetings: number;
  requirements: number;
}

export interface NoteMoveAuditEntry {
  id: string;
  userId: string;
  noteId: string;
  kind: 'move' | 'undo';
  fromClientId: string | null;
  toClientId: string | null; // null for an undo (the note is gone)
  counts: NoteMoveCounts;
  occurredAt: number;
}

export interface NewNoteMoveAudit {
  noteId: string;
  kind: 'move' | 'undo';
  fromClientId: string | null;
  toClientId: string | null;
  counts: NoteMoveCounts;
}

export interface NoteMoveAuditRepository {
  record(userId: string, entry: NewNoteMoveAudit): Promise<NoteMoveAuditEntry>;
  listByUser(userId: string): Promise<NoteMoveAuditEntry[]>;
}
