import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { CorrectionRepository } from '../../ports/correction-repository.js';

/**
 * [TRAINING-RETENTION] Age out the training corpus. The spec repeatedly called for a retention
 * policy; none existed — extraction_logs + corrections lived until account deletion, making the
 * highest-concentration client-PII store an unbounded, permanent archive. This sweeps BOTH tables
 * (one window, so the privacy page can state a single period truthfully) by AGE ONLY — never
 * selective, never cherry-picking which rows survive.
 *
 * DISABLED by default (retentionDays = 0): the window is Wabil's decision, not the model's, so the
 * mechanism ships inert and deletes NOTHING until a window is configured. Proposed default: 180 days
 * (see TRAINING-FIX-REPORT.md) — long enough to accumulate distillation signal across prompt
 * versions, short enough to bound third-party client-data exposure to a period the privacy page can
 * name. Runs on the scheduled-job seam (recorded in scheduled_job_runs like every other job).
 */
export interface TrainingRetentionDeps {
  extractionLog: Pick<ExtractionLogRepository, 'purgeOlderThan'>;
  corrections: Pick<CorrectionRepository, 'purgeOlderThan'>;
  /** All tenant ids — the sweep is per-tenant (RLS-scoped), matching the other cross-tenant jobs. */
  allUserIds: () => Promise<string[]>;
  /** Retention window in days. 0 (or negative) → disabled: retain indefinitely, delete nothing. */
  retentionDays: number;
}

export interface RetentionResult {
  enabled: boolean;
  logs: number;
  corrections: number;
  users: number;
  cutoffMs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class TrainingRetentionService {
  constructor(private readonly deps: TrainingRetentionDeps) {}

  async sweep(nowMs: number): Promise<RetentionResult> {
    const days = this.deps.retentionDays;
    if (!days || days <= 0) {
      // Unconfigured: the policy is undecided, so we never delete on a number the model picked.
      return { enabled: false, logs: 0, corrections: 0, users: 0, cutoffMs: null };
    }
    const cutoffMs = nowMs - days * DAY_MS;
    const users = await this.deps.allUserIds();
    let logs = 0;
    let corrections = 0;
    for (const userId of users) {
      logs += await this.deps.extractionLog.purgeOlderThan(userId, cutoffMs);
      corrections += await this.deps.corrections.purgeOlderThan(userId, cutoffMs);
    }
    return { enabled: true, logs, corrections, users: users.length, cutoffMs };
  }
}
