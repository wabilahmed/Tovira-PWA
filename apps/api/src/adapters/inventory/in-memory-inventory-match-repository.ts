import { randomUUID } from 'node:crypto';
import type {
  InventoryMatchRepository,
  MatchRecord,
  MatchUpsert,
} from '../../ports/inventory-match-repository.js';

/** In-memory match store mirroring the RLS + unique-pairing contract, for tests. */
export class InMemoryInventoryMatchRepository implements InventoryMatchRepository {
  private rows: MatchRecord[] = [];
  private seq = 0;

  private find(userId: string, requirementId: string, itemId: string): MatchRecord | undefined {
    return this.rows.find((r) => r.userId === userId && r.requirementId === requirementId && r.itemId === itemId);
  }

  async upsert(userId: string, m: MatchUpsert): Promise<MatchRecord> {
    const existing = this.find(userId, m.requirementId, m.itemId);
    if (existing) {
      // A dismissed pairing STAYS dismissed — never resurfaces, from either match direction.
      if (existing.status === 'dismissed') return { ...existing };
      existing.similarity = m.similarity;
      existing.confidence = m.confidence;
      return { ...existing };
    }
    const row: MatchRecord = {
      id: randomUUID(),
      userId,
      requirementId: m.requirementId,
      itemId: m.itemId,
      clientId: m.clientId,
      similarity: m.similarity,
      confidence: m.confidence,
      status: 'open',
      createdAt: Date.now() + this.seq++,
      dismissedAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async findPairing(userId: string, requirementId: string, itemId: string): Promise<MatchRecord | null> {
    const r = this.find(userId, requirementId, itemId);
    return r ? { ...r } : null;
  }

  async listOpenByClient(userId: string, clientId: string): Promise<MatchRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.clientId === clientId && r.status === 'open')
      .sort((a, b) => b.similarity - a.similarity)
      .map((r) => ({ ...r }));
  }

  async listOpenByItem(userId: string, itemId: string): Promise<MatchRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.itemId === itemId && r.status === 'open')
      .sort((a, b) => b.similarity - a.similarity)
      .map((r) => ({ ...r }));
  }

  async dismiss(userId: string, matchId: string): Promise<void> {
    const r = this.rows.find((x) => x.userId === userId && x.id === matchId);
    if (r && r.status === 'open') {
      r.status = 'dismissed';
      r.dismissedAt = Date.now() + this.seq++;
    }
  }

  async reassignByRequirements(userId: string, requirementIds: string[], toClientId: string): Promise<number> {
    const ids = new Set(requirementIds);
    let n = 0;
    for (const r of this.rows) if (r.userId === userId && ids.has(r.requirementId)) { r.clientId = toClientId; n += 1; }
    return n;
  }

  async deleteByRequirements(userId: string, requirementIds: string[]): Promise<number> {
    const ids = new Set(requirementIds);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.userId === userId && ids.has(r.requirementId)));
    return before - this.rows.length;
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
