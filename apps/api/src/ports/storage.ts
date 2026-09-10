/**
 * Port: blob storage (voice audio, gallery images). Local dev uses the
 * filesystem; prod uses S3 — swappable behind this interface.
 */

export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  /** Remove a blob. Idempotent — deleting a missing key is a no-op, not an error. Needed so account
   *  deletion can purge archived training objects (TRAINING-DELETE), not just the hot table rows. */
  delete(key: string): Promise<void>;
}
