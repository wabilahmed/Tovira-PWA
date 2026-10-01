import { randomUUID } from 'node:crypto';
import type { AccessRequestInput, AccessRequestRecord, AccessRequestRepository, AccessRequestReview, AccessRequestStatus } from '../../ports/access-request-repository.js';

/** In-memory access-request store for tests and local runs. */
export class InMemoryAccessRequestRepository implements AccessRequestRepository {
  private readonly byId = new Map<string, AccessRequestRecord>();
  private seq = 0;

  async create(input: AccessRequestInput): Promise<AccessRequestRecord> {
    const record: AccessRequestRecord = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now() + this.seq++, // strictly increasing so list() ordering is deterministic in tests
      status: 'pending',
      reviewedAt: null,
      reviewedNote: null,
      linkedUserId: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<AccessRequestRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async list(status?: AccessRequestStatus): Promise<AccessRequestRecord[]> {
    return [...this.byId.values()]
      .filter((r) => status === undefined || r.status === status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async review(id: string, patch: AccessRequestReview): Promise<AccessRequestRecord | null> {
    const rec = this.byId.get(id);
    if (!rec) return null;
    rec.status = patch.status;
    rec.reviewedAt = patch.reviewedAt;
    if (patch.reviewedNote !== undefined) rec.reviewedNote = patch.reviewedNote;
    if (patch.linkedUserId !== undefined) rec.linkedUserId = patch.linkedUserId;
    return rec;
  }

  /** [BETA-6] Set status only, preserving reviewedAt/note (used by the in-memory invite-activation tx). */
  setStatus(id: string, status: AccessRequestStatus): void {
    const rec = this.byId.get(id);
    if (rec) rec.status = status;
  }

  async count(): Promise<number> {
    return this.byId.size;
  }
}
