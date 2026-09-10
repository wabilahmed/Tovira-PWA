import { randomUUID } from 'node:crypto';
import type {
  CorrectionEntry,
  CorrectionRecord,
  CorrectionRepository,
} from '../../ports/correction-repository.js';

/** In-memory correction log for tests. */
export class InMemoryCorrectionRepository implements CorrectionRepository {
  private rows: CorrectionRecord[] = [];

  async record(userId: string, entry: CorrectionEntry): Promise<void> {
    this.rows.push({ ...entry, id: randomUUID(), userId, createdAt: Date.now() });
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }

  async listByUser(userId: string): Promise<CorrectionRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async listOlderThan(userId: string, cutoffMs: number): Promise<CorrectionRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.createdAt < cutoffMs)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async deleteByIds(userId: string, ids: string[]): Promise<number> {
    const set = new Set(ids);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.userId === userId && set.has(r.id)));
    return before - this.rows.length;
  }

  /** [TRAINING-METRICS] Cross-tenant count for the stats repo (tests). */
  countAll(): number {
    return this.rows.length;
  }
}
