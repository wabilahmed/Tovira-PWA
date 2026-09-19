import { randomUUID } from 'node:crypto';
import type { ErasureAuditRepository, ErasureAuditRecord, ErasureAuditEntry } from '../../ports/erasure-audit-repository.js';

export class InMemoryErasureAuditRepository implements ErasureAuditRepository {
  private rows: ErasureAuditRecord[] = [];

  async record(userId: string, entry: ErasureAuditEntry): Promise<ErasureAuditRecord> {
    const rec: ErasureAuditRecord = { id: randomUUID(), userId, at: Date.now(), ...entry };
    this.rows.push(rec);
    return rec;
  }

  async listByUser(userId: string): Promise<ErasureAuditRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
