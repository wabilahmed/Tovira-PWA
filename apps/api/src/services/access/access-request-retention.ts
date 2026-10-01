import type { AccessRequestRepository } from '../../ports/access-request-repository.js';

/** How long a stale (rejected or never-acted-on pending) access request is kept before the retention
 *  sweep deletes it. Derivation: 90 days is long enough to review, reconsider, or answer a follow-up
 *  about a request, while bounding how long we hold personal data collected from a non-user who did not
 *  become a customer (data-minimisation). Approved/invited/activated requests are NOT subject to this —
 *  they are the authority record of who was granted access. */
export const ACCESS_REQUEST_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [BETA-8] Deletes stale access requests. Runs on the existing ScheduledBrain (advisory-lock + timer),
 *  NOT a second scheduler — see the job registration in index.ts. Idempotent: a re-run after everything
 *  stale is gone deletes nothing. */
export class AccessRequestRetentionService {
  private readonly now: () => number;
  constructor(
    private readonly requests: AccessRequestRepository,
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
  }

  /** Delete pending/rejected requests older than the retention window. Returns how many were removed. */
  async sweep(nowMs: number = this.now()): Promise<number> {
    return this.requests.deleteStale(nowMs - ACCESS_REQUEST_RETENTION_DAYS * DAY_MS);
  }
}
