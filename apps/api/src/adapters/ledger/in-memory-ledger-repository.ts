import { randomUUID } from 'node:crypto';
import type { DealValue, LedgerEvent, LedgerEventRecord, LedgerRepository } from '../../ports/ledger-repository.js';

/** In-memory ledger for tests, mirroring the RLS isolation contract. */
export class InMemoryLedgerRepository implements LedgerRepository {
  private rows: LedgerEventRecord[] = [];
  private deals = new Map<string, DealValue[]>(); // userId → deal values

  async record(userId: string, event: LedgerEvent): Promise<boolean> {
    if (this.rows.some((r) => r.userId === userId && r.dedupeKey === event.dedupeKey)) return false;
    this.rows.push({ ...event, id: randomUUID(), userId });
    return true;
  }

  async listByUser(userId: string): Promise<LedgerEventRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async removeBySource(userId: string, sourceId: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.sourceId === sourceId));
  }

  async setDealValue(userId: string, clientId: string, aed: number): Promise<void> {
    const list = this.deals.get(userId) ?? [];
    const existing = list.find((d) => d.clientId === clientId);
    if (existing) existing.aed = aed;
    else list.push({ clientId, aed });
    this.deals.set(userId, list);
  }

  async listDealValues(userId: string): Promise<DealValue[]> {
    return this.deals.get(userId) ?? [];
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
    this.deals.delete(userId);
  }
}
