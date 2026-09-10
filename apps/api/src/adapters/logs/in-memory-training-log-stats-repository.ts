import type { TrainingLogStats, TrainingLogStatsRepository } from '../../ports/training-log-stats-repository.js';
import type { InMemoryExtractionLogRepository } from './in-memory-extraction-log-repository.js';
import type { InMemoryCorrectionRepository } from '../corrections/in-memory-correction-repository.js';

/** [TRAINING-METRICS] Composes the in-memory log + correction repos into the cross-tenant aggregate. */
export class InMemoryTrainingLogStatsRepository implements TrainingLogStatsRepository {
  constructor(
    private readonly logs: InMemoryExtractionLogRepository,
    private readonly corrections: InMemoryCorrectionRepository,
  ) {}

  async aggregate(nowMs: number): Promise<TrainingLogStats> {
    return { ...this.logs.statsAll(nowMs), corrections: this.corrections.countAll() };
  }
}
