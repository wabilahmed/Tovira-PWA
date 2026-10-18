import { randomUUID } from 'node:crypto';
import type { KeptSuggestionRepository, KeptSuggestionRecord, NewKeptSuggestion, KeptSuggestionStatus } from '../../ports/kept-suggestion-repository.js';

/** In-memory [P24-2] kept-promise suggestions, mirroring the RLS isolation + uniqueness contract. */
export class InMemoryKeptSuggestionRepository implements KeptSuggestionRepository {
  private rows: KeptSuggestionRecord[] = [];

  async createIfAbsent(userId: string, s: NewKeptSuggestion): Promise<boolean> {
    if (this.rows.some((r) => r.userId === userId && r.clientId === s.clientId && r.promiseKey === s.promiseKey && r.deliveryAt === s.deliveryAt)) return false;
    this.rows.push({ ...s, id: randomUUID(), userId, status: 'open', createdAt: Date.now(), resolvedAt: null });
    return true;
  }
  async deliveryTimes(userId: string, clientId: string, promiseKey: string): Promise<Set<string>> {
    return new Set(this.rows.filter((r) => r.userId === userId && r.clientId === clientId && r.promiseKey === promiseKey).map((r) => r.deliveryAt));
  }
  async listOpen(userId: string): Promise<KeptSuggestionRecord[]> {
    return this.rows.filter((r) => r.userId === userId && r.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(userId: string, id: string): Promise<KeptSuggestionRecord | null> {
    return this.rows.find((r) => r.userId === userId && r.id === id) ?? null;
  }
  async setStatus(userId: string, id: string, status: KeptSuggestionStatus, nowMs: number): Promise<boolean> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (!r) return false;
    r.status = status;
    r.resolvedAt = status === 'open' ? null : nowMs;
    return true;
  }
  /** [PRIVACY-3] account deletion purge (mirrors the users FK cascade in Postgres). */
  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
