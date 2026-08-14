import type { PushBudgetRepository } from '../../ports/push.js';

/** In-memory silence-budget ledger for tests. */
export class InMemoryPushBudgetRepository implements PushBudgetRepository {
  private counts = new Map<string, number>();
  private key(userId: string, dayIso: string): string {
    return `${userId}:${dayIso}`;
  }
  async countSent(userId: string, dayIso: string): Promise<number> {
    return this.counts.get(this.key(userId, dayIso)) ?? 0;
  }
  async recordSent(userId: string, dayIso: string, count: number): Promise<void> {
    this.counts.set(this.key(userId, dayIso), (await this.countSent(userId, dayIso)) + count);
  }
}
