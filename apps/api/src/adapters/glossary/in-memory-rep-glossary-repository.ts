import type { RepGlossaryEntry, RepGlossaryRepository } from '../../ports/rep-glossary-repository.js';

const norm = (s: string): string => s.trim().toLowerCase();

/** In-memory per-rep glossary (P4-9) for tests. Mirrors the pg RLS/unique contract. */
export class InMemoryRepGlossaryRepository implements RepGlossaryRepository {
  private rows: Array<RepGlossaryEntry & { userId: string }> = [];

  async upsert(userId: string, wrongTerm: string, rightTerm: string, atMs: number): Promise<void> {
    const existing = this.rows.find((r) => r.userId === userId && r.wrongTerm === wrongTerm && r.rightTerm === rightTerm);
    if (existing) {
      existing.timesCorrected += 1;
      existing.lastSeen = atMs;
    } else {
      this.rows.push({ userId, wrongTerm, rightTerm, timesCorrected: 1, firstSeen: atMs, lastSeen: atMs });
    }
  }

  async listByUser(userId: string): Promise<RepGlossaryEntry[]> {
    return this.rows
      .filter((r) => r.userId === userId)
      .map(({ userId: _u, ...e }) => e);
  }

  async deleteByTerms(userId: string, terms: string[]): Promise<number> {
    const set = new Set(terms.map(norm).filter(Boolean));
    if (set.size === 0) return 0;
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => !(r.userId === userId && (set.has(norm(r.wrongTerm)) || set.has(norm(r.rightTerm)))),
    );
    return before - this.rows.length;
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
