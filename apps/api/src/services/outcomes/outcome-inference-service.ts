import type { ClientRepository } from '../../ports/client-repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OutcomeInferenceDeps {
  clients: Pick<ClientRepository, 'listByUser' | 'setOutcome' | 'clearOutcome'>;
  /** Every rep whose book the nightly recompute walks. */
  allUserIds: () => Promise<string[]>;
  /** Days of silence after which an open client is inferred lost (config.lostInferredThresholdDays). */
  thresholdDays: number;
  now?: () => number;
}

export interface RecomputeResult {
  inferred: number;
  reverted: number;
}

/**
 * [OUTCOME-2] The deterministic lost_inferred rule — NO model call, no message-content analysis.
 *
 * A client becomes `lost_inferred` when it has been silent past the threshold AND has no won signal.
 * "Silent" is measured on `clients.last_touched_at` (the same clock the going-cold alert reads), so a
 * new capture — which bumps last_touched_at — automatically makes the next run revert the inference.
 *
 * Two hard rules, both tested:
 *  - A rep-set outcome ALWAYS wins: inference never touches a client whose outcome_source is 'rep'
 *    (won, lost_confirmed, or a rep-set "still open"). "No won signal" falls out of this — a won
 *    client is rep-set, so it is skipped.
 *  - Recomputable and reversible: when activity resumes (silence drops back under the threshold), an
 *    INFERRED loss is cleared back to the untouched default. A rep-set outcome is never cleared here.
 *
 * The recompute is idempotent: a client already at the correct state is not rewritten, so re-running
 * (nightly, or twice in one night under the advisory lock) changes nothing and never re-stamps
 * outcome_changed_at.
 */
export class OutcomeInferenceService {
  private readonly now: () => number;
  constructor(private readonly deps: OutcomeInferenceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Recompute every rep's book. Returns totals for logging / the /health-style report. */
  async recompute(nowMs = this.now()): Promise<RecomputeResult> {
    const total: RecomputeResult = { inferred: 0, reverted: 0 };
    for (const userId of await this.deps.allUserIds()) {
      const r = await this.recomputeUser(userId, nowMs);
      total.inferred += r.inferred;
      total.reverted += r.reverted;
    }
    return total;
  }

  /** Recompute a single rep's book. */
  async recomputeUser(userId: string, nowMs: number): Promise<RecomputeResult> {
    const result: RecomputeResult = { inferred: 0, reverted: 0 };
    for (const c of await this.deps.clients.listByUser(userId)) {
      // A rep-set outcome always wins — inference must never overwrite it.
      if (c.outcomeSource === 'rep') continue;

      const silentDays = Math.floor((nowMs - c.lastTouchedAt) / DAY_MS);
      const silentEnough = silentDays >= this.deps.thresholdDays;

      if (silentEnough && c.outcome === 'open') {
        // Open + no won signal (outcome is 'open', not 'won') + silent past the threshold → infer lost.
        await this.deps.clients.setOutcome(userId, c.id, 'lost_inferred', 'inferred', nowMs);
        result.inferred += 1;
      } else if (!silentEnough && c.outcome === 'lost_inferred') {
        // Activity resumed (a capture bumped last_touched_at) → clear the inference, back to open.
        await this.deps.clients.clearOutcome(userId, c.id);
        result.reverted += 1;
      }
      // Everything else (open+recent, already-correct lost_inferred, etc.) is a no-op → idempotent.
    }
    return result;
  }
}
