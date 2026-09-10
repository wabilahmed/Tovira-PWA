import type {
  ArchiveIndexRepository,
  ArchiveObjectInput,
  ArchiveObjectRecord,
} from '../../ports/archive-index-repository.js';

/** In-memory archive index for tests. */
export class InMemoryArchiveIndexRepository implements ArchiveIndexRepository {
  private rows: ArchiveObjectRecord[] = [];

  async upsert(userId: string, entry: ArchiveObjectInput): Promise<void> {
    const existing = this.rows.find(
      (r) => r.userId === userId && r.collection === entry.collection && r.partition === entry.partition,
    );
    if (existing) {
      existing.objectKey = entry.objectKey;
      existing.rowCount = entry.rowCount;
      existing.archivedAt = Date.now();
    } else {
      this.rows.push({ userId, ...entry, archivedAt: Date.now() });
    }
  }

  async listByUser(userId: string): Promise<ArchiveObjectRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async deleteByUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }

  async totalRowCount(): Promise<number> {
    return this.rows.reduce((sum, r) => sum + r.rowCount, 0);
  }
}
