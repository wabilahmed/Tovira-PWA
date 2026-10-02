import type { TrainingLogStats, TrainingLogStatsRepository } from '../../ports/training-log-stats-repository.js';
import type { InMemoryExtractionLogRepository } from './in-memory-extraction-log-repository.js';
import type { InMemoryCorrectionRepository } from '../corrections/in-memory-correction-repository.js';

/** [EXTRACTION-METRICS] Composes the in-memory extraction-log + correction repos into the cross-tenant
 *  operational aggregate (counts only). [NO-TRAINING-RETENTION] no archive, no content. */
export class InMemoryTrainingLogStatsRepository implements TrainingLogStatsRepository {
  constructor(
    private readonly logs: InMemoryExtractionLogRepository,
    private readonly corrections: InMemoryCorrectionRepository,
  ) {}

  async aggregate(nowMs: number): Promise<TrainingLogStats> {
    return {
      ...this.logs.statsAll(nowMs),
      corrections: this.corrections.countAll(),
    };
  }
}
