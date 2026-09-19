import { randomUUID } from 'node:crypto';
import type { ErasureRequestRepository, ErasureRequestRecord, NewErasureRequest, ErasureRequestStatus } from '../../ports/erasure-request-repository.js';

export class InMemoryErasureRequestRepository implements ErasureRequestRepository {
  private rows: ErasureRequestRecord[] = [];

  async create(userId: string, input: NewErasureRequest): Promise<ErasureRequestRecord> {
    const rec: ErasureRequestRecord = { id: randomUUID(), userId, status: 'pending', ...input };
    this.rows.push(rec);
    return rec;
  }
  async get(userId: string, id: string): Promise<ErasureRequestRecord | null> {
    return this.rows.find((r) => r.userId === userId && r.id === id) ?? null;
  }
  async setStatus(userId: string, id: string, status: ErasureRequestStatus): Promise<boolean> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (!r) return false;
    r.status = status;
    return true;
  }
  async listByUser(userId: string): Promise<ErasureRequestRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }
  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
