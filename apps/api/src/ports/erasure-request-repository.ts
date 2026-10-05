/**
 * Port: a pending single-counterparty erasure request (Terms 4.9). Between intake and completion the
 * rep has a window to assert a legal basis for retention. Tenant-scoped.
 */

/**
 * [TASK 2] `rejected` and `withdrawn` are non-erasing TERMINAL states that end the retention/processing
 * window WITHOUT deleting anything: `rejected` = the operator decided the request is not carried out
 * (e.g. an asserted retention basis is upheld, or the request is not valid); `withdrawn` = the requester
 * took the request back. Either lifts the processing restriction and leaves the data in place. The
 * `status` column is free text (no DB CHECK — see migration 0066), so these need no schema change; they
 * are enforced here in the app.
 */
export type ErasureRequestStatus = 'pending' | 'retention_asserted' | 'completed' | 'rejected' | 'withdrawn';

/** The non-terminal states during which processing is restricted (the request is still "live"). */
export const ACTIVE_ERASURE_STATUSES: readonly ErasureRequestStatus[] = ['pending', 'retention_asserted'];
export function isActiveErasure(status: ErasureRequestStatus): boolean {
  return status === 'pending' || status === 'retention_asserted';
}

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
