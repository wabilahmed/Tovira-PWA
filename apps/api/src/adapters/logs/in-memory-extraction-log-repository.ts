import { randomUUID } from 'node:crypto';
import type {
  ExtractionLogEntry,
  ExtractionLogRecord,
  ExtractionLogRepository,
} from '../../ports/extraction-log-repository.js';

/** In-memory extraction log for tests. */
export class InMemoryExtractionLogRepository implements ExtractionLogRepository {
  private rows: ExtractionLogRecord[] = [];

  async log(userId: string, entry: ExtractionLogEntry): Promise<void> {
    this.rows.push({ ...entry, id: randomUUID(), userId, createdAt: Date.now() });
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }

  async listByUser(userId: string): Promise<ExtractionLogRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }
}
