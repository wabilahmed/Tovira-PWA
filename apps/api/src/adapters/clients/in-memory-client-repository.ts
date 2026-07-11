import { randomUUID } from 'node:crypto';
import type { ClientRecord, ClientRepository } from '../../ports/client-repository.js';

/** In-memory client store mirroring the RLS isolation contract, for tests. */
export class InMemoryClientRepository implements ClientRepository {
  private readonly byId = new Map<string, ClientRecord>();

  async create(userId: string, name: string): Promise<ClientRecord> {
    const record: ClientRecord = { id: randomUUID(), userId, name, createdAt: Date.now() };
    this.byId.set(record.id, record);
    return record;
  }

  async listByUser(userId: string): Promise<ClientRecord[]> {
    return [...this.byId.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByIdForUser(userId: string, id: string): Promise<ClientRecord | null> {
    const client = this.byId.get(id);
    return client && client.userId === userId ? client : null;
  }
}
