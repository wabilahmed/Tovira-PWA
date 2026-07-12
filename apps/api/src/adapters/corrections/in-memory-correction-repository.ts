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

  async listByUser(userId: string): Promise<CorrectionRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }
}
