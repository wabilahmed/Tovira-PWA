import type { SensitiveFlagStatsRepository, SensitiveFlagRestoreStat } from '../../ports/sensitive-flag-stats-repository.js';

const SEP = '\u0000'; // a byte that cannot occur in a category or a matched span

/**
 * [RESTORE-SIGNAL] In-memory aggregate counter keyed by (category, span). Holds nothing else — no
 * identifier, no content — so it cannot attribute a restore to a rep or a book.
 */
export class InMemorySensitiveFlagStatsRepository implements SensitiveFlagStatsRepository {
  private readonly counts = new Map<string, number>();

  async recordRestore(category: string, span: string): Promise<void> {
    const key = `${category}${SEP}${span}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  async list(): Promise<SensitiveFlagRestoreStat[]> {
    return [...this.counts.entries()].map(([key, restored]) => {
      const [category, span] = key.split(SEP);
      return { category: category!, span: span!, restored };
    });
  }
}
