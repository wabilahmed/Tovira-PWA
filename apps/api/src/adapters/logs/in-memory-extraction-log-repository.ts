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

  async findPromptVersionByNote(userId: string, noteId: string): Promise<string | null> {
    const matches = this.rows.filter((r) => r.userId === userId && r.noteId === noteId);
    if (matches.length === 0) return null;
    // Most recent wins (the prompt in effect when this note was last extracted).
    return matches.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a)).promptVersion;
  }

  async labelOutcomeByNote(userId: string, noteId: string, status: string): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && r.noteId === noteId) {
        r.status = status;
        n += 1;
      }
    }
    return n;
  }

  async listOlderThan(userId: string, cutoffMs: number): Promise<ExtractionLogRecord[]> {
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

  /** [TRAINING-METRICS] Cross-tenant counts for the stats repo (tests). */
  statsAll(nowMs: number): { total: number; last24h: number; emptyOutput: number; byPromptVersion: Record<string, number> } {
    const since = nowMs - 24 * 60 * 60 * 1000;
    const byPromptVersion: Record<string, number> = {};
    let last24h = 0;
    let emptyOutput = 0;
    for (const r of this.rows) {
      byPromptVersion[r.promptVersion] = (byPromptVersion[r.promptVersion] ?? 0) + 1;
      if (r.createdAt >= since) last24h += 1;
      if (r.rawOutput === null || r.rawOutput.trim() === '') emptyOutput += 1;
    }
    return { total: this.rows.length, last24h, emptyOutput, byPromptVersion };
  }
}
