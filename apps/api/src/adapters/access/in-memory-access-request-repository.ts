import { randomUUID } from 'node:crypto';
import type { AccessRequestInput, AccessRequestRecord, AccessRequestRepository } from '../../ports/access-request-repository.js';

/** In-memory access-request store for tests and local runs. */
export class InMemoryAccessRequestRepository implements AccessRequestRepository {
  private readonly byId = new Map<string, AccessRequestRecord>();

  async create(input: AccessRequestInput): Promise<AccessRequestRecord> {
    const record: AccessRequestRecord = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
      status: 'pending',
      reviewedAt: null,
      reviewedNote: null,
      linkedUserId: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async count(): Promise<number> {
    return this.byId.size;
  }
}
