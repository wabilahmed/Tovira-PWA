import { randomUUID } from 'node:crypto';
import type { NoteMoveAuditEntry, NoteMoveAuditRepository, NewNoteMoveAudit } from '../../ports/note-move-audit-repository.js';

/** In-memory audit trail mirroring the RLS isolation contract, for tests. */
export class InMemoryNoteMoveAuditRepository implements NoteMoveAuditRepository {
  private readonly entries: NoteMoveAuditEntry[] = [];
  private seq = 0;

  async record(userId: string, entry: NewNoteMoveAudit): Promise<NoteMoveAuditEntry> {
    const record: NoteMoveAuditEntry = { id: randomUUID(), userId, occurredAt: Date.now() + this.seq++, ...entry };
    this.entries.push(record);
    return record;
  }

  async listByUser(userId: string): Promise<NoteMoveAuditEntry[]> {
    return this.entries.filter((e) => e.userId === userId).sort((a, b) => b.occurredAt - a.occurredAt);
  }
}
