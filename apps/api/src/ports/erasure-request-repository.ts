/**
 * Port: a pending single-counterparty erasure request (Terms 4.9). Between intake and completion the
 * rep has a window to assert a legal basis for retention. Tenant-scoped.
 */

export type ErasureRequestStatus = 'pending' | 'retention_asserted' | 'completed';

export interface ErasureRequestRecord {
  id: string;
  userId: string;
  requesterNames: string[];
  requestedAt: number;
  /** The rep may assert a legal basis for retention until this instant (Terms 4.9). */
  windowEndsAt: number;
  status: ErasureRequestStatus;
}

export interface NewErasureRequest {
  requesterNames: string[];
  requestedAt: number;
  windowEndsAt: number;
}

export interface ErasureRequestRepository {
  create(userId: string, input: NewErasureRequest): Promise<ErasureRequestRecord>;
  get(userId: string, id: string): Promise<ErasureRequestRecord | null>;
  setStatus(userId: string, id: string, status: ErasureRequestStatus): Promise<boolean>;
  listByUser(userId: string): Promise<ErasureRequestRecord[]>;
}
