import type { ErasureCategoryCount } from './erasure-audit-repository.js';

/**
 * [ERASURE-RECEIPT] The minimal, compliance-grade proof that a single-counterparty erasure was
 * HONOURED — kept so we can demonstrate to a data-subject or a regulator that an Art. 17 request was
 * carried out, EVEN AFTER the rep closes their account.
 *
 * The tenant `erasure_audit` is on the `users` FK cascade (Privacy §10 Task 3 finding): it is destroyed
 * when the rep deletes their account, taking the only proof with it. This store is the answer, and it
 * is deliberately shaped so it CANNOT be swept away with the rep:
 *   - NO `user_id` and NO foreign key of any kind → the account-deletion cascade cannot reach it, and it
 *     is not tenant-scoped (there is nothing to purge by user).
 *   - NO requester name, NO rep id, NO erased content — only a request id, the two dates, and per-store
 *     COUNTS. So the surviving record is the leanest thing that still proves the erasure ran.
 *
 * It is (pseudonymous) personal data all the same — a request id + dates is indirectly linkable — so it
 * is retained under its own legal-obligation basis with its own cap, never mixed back into rep data.
 */
export interface ErasureReceipt {
  /** The originating request's id (an unguessable uuid). Not linked by FK — the request row is itself
   *  purged on account deletion; this is a bare identifier, not a reference. */
  requestId: string;
  /** Date the erasure request was received (from the request's requestedAt). */
  receivedAt: number;
  /** Date the erasure was completed. */
  completedAt: number;
  /** Per-store counts of what was removed — shape only, never content or names. */
  categories: ErasureCategoryCount[];
}

export interface ErasureReceiptRepository {
  /** Write one receipt. Takes NO userId — the record is not attributed to an account, by design. */
  record(receipt: ErasureReceipt): Promise<void>;
  get(requestId: string): Promise<ErasureReceipt | null>;
  list(): Promise<ErasureReceipt[]>;
  /**
   * Deletion-fan-out safety. A retention receipt must NEVER be removed by account deletion, so this is
   * a deliberate NO-OP — the whole point is that it outlives the account. It exists so the store is safe
   * even if it is ever added to the account-deletion purge list; the guarantee is locked by a test.
   */
  purgeUser(userId: string): Promise<void>;
}
