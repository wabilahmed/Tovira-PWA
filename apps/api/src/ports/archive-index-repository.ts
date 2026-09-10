/**
 * Port: the index of archived training-log partitions (TRAINING-ARCHIVE). The Storage port has no
 * `list`, so this is how the archive is enumerated — for account deletion (purge the objects),
 * export (include archived rows), and /health (sum the archived corpus). One row per
 * (user, collection, partition); archiving a partition upserts it (idempotent).
 */
export interface ArchiveObjectRecord {
  userId: string;
  collection: string; // 'extraction_logs' | 'corrections'
  partition: string; // 'YYYY-MM'
  objectKey: string;
  rowCount: number;
  archivedAt: number;
}

export interface ArchiveObjectInput {
  collection: string;
  partition: string;
  objectKey: string;
  rowCount: number;
}

export interface ArchiveIndexRepository {
  /** Record (or update) an archived partition's object. Idempotent per (user, collection, partition). */
  upsert(userId: string, entry: ArchiveObjectInput): Promise<void>;
  /** All of this tenant's archived objects — for deletion + export. */
  listByUser(userId: string): Promise<ArchiveObjectRecord[]>;
  /** Remove this tenant's index rows (after the objects themselves are deleted). */
  deleteByUser(userId: string): Promise<void>;
  /** Cross-tenant total archived row count, for /health. Runs on the superuser pool (no RLS). */
  totalRowCount(): Promise<number>;
}
