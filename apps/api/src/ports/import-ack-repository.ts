/**
 * [PRIVACY-5] First-import acknowledgement. Before the FIRST chat-export upload in an account, the rep
 * must acknowledge they have the right to upload messages written by other people. It is recorded once
 * per account (not per import), with a timestamp, server-side (so it survives logout), and tenant-scoped.
 */

/** [PLACEHOLDER WORDING — owner to finalise before the policy is published.] The notice shown before
 *  the first import. Task 5 supplied this sentence as a placeholder; it is a product/legal decision. */
export const FIRST_IMPORT_NOTICE =
  'You are about to upload messages written by other people. Confirm you have the right to do so.';

export interface ImportAckRepository {
  /** Epoch ms of the account's first acknowledgement, or null if it has never acknowledged. Scoped
   *  to the owner. */
  acknowledgedAt(userId: string): Promise<number | null>;
  /** Record the acknowledgement. First write wins — a second call keeps the original timestamp, so
   *  the record is once-per-account and the "when did they first agree" answer is stable. */
  acknowledge(userId: string, atMs: number): Promise<void>;
  /** Account-deletion purge. */
  purgeUser(userId: string): Promise<void>;
}
