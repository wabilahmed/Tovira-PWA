import type { TodayAction } from '../services/hero/hero-service.js';

/**
 * Port: the precomputed daily-priorities cache (cost-guard #3, P4b-3). One row
 * per rep per day; app-opens read it instead of recomputing (which would cost a
 * model call every open). Tenant-scoped (RLS on pg).
 */
export interface PrioritiesRecord {
  userId: string;
  day: string; // YYYY-MM-DD (UTC)
  actions: TodayAction[];
  refreshCount: number;
  computedAt: number;
}

export interface PrioritiesRepository {
  get(userId: string, day: string): Promise<PrioritiesRecord | null>;
  /** Upsert the day's row (actions + refresh count). */
  save(userId: string, day: string, actions: TodayAction[], refreshCount: number): Promise<void>;
}
