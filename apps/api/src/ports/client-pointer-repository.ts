import type { Pointer } from '../services/extraction/types.js';

/**
 * [POINTERS · Task 3] A per-client pointer set — the current relationship/closing pointers for one
 * client, replaced wholesale on each extraction (keep/revise/retire/add is decided by the model + the
 * post-check, D7). RLS-scoped like every tenant table. (Receipts cite messages by verbatim span +
 * timestamp — there are no message rows to foreign-key to; the FK is to the client only.)
 */
export interface ClientPointerSet {
  clientId: string;
  pointers: Pointer[];
  /** [D6] the exact retrospective disclosure, when the set contains a retrospective; null otherwise. */
  retrospectiveDisclosure: string | null;
  updatedAt: number;
}

export interface ClientPointerRepository {
  getForClient(userId: string, clientId: string): Promise<ClientPointerSet | null>;
  /** Replace the client's whole set (D7 — the post-checked keep/revise/retire/add result). */
  save(userId: string, clientId: string, set: { pointers: Pointer[]; retrospectiveDisclosure: string | null }, nowMs: number): Promise<void>;
  /** [D10] Erasure: drop a client's set so it regenerates from what remains on the next extraction. */
  deleteForClient(userId: string, clientId: string): Promise<void>;
  /** [D10] Account deletion: remove all of a rep's pointer sets. */
  purgeUser(userId: string): Promise<void>;
  /** [D10] Data export: every pointer set the rep holds. */
  listByUser(userId: string): Promise<ClientPointerSet[]>;
}
