import { randomUUID } from 'node:crypto';
import type { ClientRecord, ClientRepository } from '../../ports/client-repository.js';

/** In-memory client store mirroring the RLS isolation contract, for tests. */
export class InMemoryClientRepository implements ClientRepository {
  private readonly byId = new Map<string, ClientRecord>();
  private clock = 0;

  /** Monotonic recency stamp so ordering is deterministic even within a ms. */
  private tick(): number {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return this.clock;
  }

  async create(userId: string, name: string, phone: string | null = null, title: string | null = null, email: string | null = null): Promise<ClientRecord> {
    const now = this.tick();
    const record: ClientRecord = { id: randomUUID(), userId, name, phone, title, email, createdAt: now, lastTouchedAt: now };
    this.byId.set(record.id, record);
    return record;
  }

  async setPhone(userId: string, id: string, phone: string | null): Promise<void> {
    const client = this.byId.get(id);
    if (client && client.userId === userId) client.phone = phone;
  }

  private ownedByUser(userId: string): ClientRecord[] {
    return [...this.byId.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
  }

  async listByUser(userId: string): Promise<ClientRecord[]> {
    return this.ownedByUser(userId);
  }

  async search(userId: string, query: string): Promise<ClientRecord[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.ownedByUser(userId);
    return this.ownedByUser(userId).filter((c) => c.name.toLowerCase().includes(needle));
  }

  async findByIdForUser(userId: string, id: string): Promise<ClientRecord | null> {
    const client = this.byId.get(id);
    return client && client.userId === userId ? client : null;
  }

  async touch(userId: string, id: string): Promise<void> {
    const client = this.byId.get(id);
    if (client && client.userId === userId) client.lastTouchedAt = this.tick();
  }

  async setLastTouched(userId: string, id: string, ms: number): Promise<void> {
    const client = this.byId.get(id);
    if (client && client.userId === userId) client.lastTouchedAt = ms;
  }

  async purgeUser(userId: string): Promise<void> {
    for (const [id, c] of this.byId) if (c.userId === userId) this.byId.delete(id);
  }

  async listGoingCold(userId: string, cutoffMs: number): Promise<ClientRecord[]> {
    return this.ownedByUser(userId).filter((c) => c.lastTouchedAt < cutoffMs);
  }
}
