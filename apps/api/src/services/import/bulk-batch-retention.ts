/**
 * [BULK-IMPORT · FIX 2c] Retention sweep for staged uploads. A pending batch holds pre-review
 * third-party conversation content; it is normally deleted the moment the import completes (a) or the
 * rep abandons the review (b), but a crash or an abandoned tab can leave one behind. This drops any
 * batch older than the TTL, whatever its state.
 */
import type { Storage } from '../../ports/storage.js';
import { listBatches, clearBatch } from './bulk-batch-store.js';

/**
 * How long a staged batch may linger before the sweep removes it. Derivation: a rep exports, reviews
 * and imports in one sitting; 24h is generous for a review paused across a break while bounding how long
 * un-reviewed, un-imported chats sit in Storage. Not a user-facing setting.
 */
export const BULK_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

export class BulkBatchRetentionService {
  constructor(private readonly storage: Storage, private readonly ttlMs: number = BULK_BATCH_TTL_MS) {}

  async sweep(nowMs: number): Promise<number> {
    let deleted = 0;
    for (const b of await listBatches(this.storage)) {
      if (nowMs - b.createdAt >= this.ttlMs) {
        await clearBatch(this.storage, b.userId, b.batchId);
        deleted += 1;
      }
    }
    return deleted;
  }
}
