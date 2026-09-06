import type { SpendOverrideRepository, SpendOverride, NewSpendOverride } from '../../ports/spend-override-repository.js';

/** In-memory override + audit store (tests + local). Append-only; latest per (user, period) wins. */
export class InMemorySpendOverrideRepository implements SpendOverrideRepository {
  private readonly rows: SpendOverride[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async set(o: NewSpendOverride): Promise<SpendOverride> {
    const row: SpendOverride = { id: `ovr-${++this.seq}`, ...o, occurredAt: this.now() };
    this.rows.push(row);
    return row;
  }

  async effectiveCap(userId: string, periodKey: string): Promise<number | null> {
    const matches = this.rows.filter((r) => r.userId === userId && r.periodKey === periodKey);
    return matches.length ? matches[matches.length - 1]!.capAed : null;
  }

  async listAudit(limit: number): Promise<SpendOverride[]> {
    return [...this.rows].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  }
}
