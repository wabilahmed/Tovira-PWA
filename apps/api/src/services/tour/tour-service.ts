import type { UserRepository } from '../../ports/user-repository.js';
import type { TourFunnelRepository } from '../../ports/tour-funnel-repository.js';

/** [P37] The required first-login tour. Bump TOUR_VERSION to require a new tour of every account. */
export const TOUR_VERSION = 1;
export const TOUR_STEPS = 9;

export interface TourState { required: boolean; step: number; steps: number; version: number }

/**
 * [P37] Completion and progress live on the account (never the browser): an account that hasn't completed the
 * current version must take it — existing accounts included — and resumes at its saved step on any device. The
 * funnel is anonymous: a step counts once per rep (the first time it is reached), plus one "completed" and one
 * "import_tapped" per completion. A replay ("Take the tour again") is client-only and writes nothing here.
 * Touches only the users row and the funnel counters — never clients, notes or facts.
 */
export class TourService {
  constructor(private readonly deps: { users: Pick<UserRepository, 'getTour' | 'setTourStep' | 'completeTour'>; funnel: TourFunnelRepository; now?: () => number }) {}

  async state(userId: string): Promise<TourState> {
    const t = await this.deps.users.getTour(userId);
    const required = t.completedVersion === null || t.completedVersion < TOUR_VERSION;
    const step = t.stepVersion === TOUR_VERSION ? Math.min(Math.max(t.step, 0), TOUR_STEPS - 1) : 0;
    return { required, step: required ? step : 0, steps: TOUR_STEPS, version: TOUR_VERSION };
  }

  /** Save the step the rep is on; count each step the first time this rep reaches it. */
  async saveStep(userId: string, step: number): Promise<void> {
    if (!Number.isInteger(step) || step < 0 || step >= TOUR_STEPS) throw new RangeError('step out of range');
    const { previousMax } = await this.deps.users.setTourStep(userId, TOUR_VERSION, step);
    for (let s = previousMax + 1; s <= step; s += 1) await this.deps.funnel.bump(TOUR_VERSION, s, 'reached');
  }

  /** The last step's "Import your first chat": the tour is complete (first time only). */
  async complete(userId: string): Promise<void> {
    if (await this.deps.users.completeTour(userId, TOUR_VERSION, (this.deps.now ?? Date.now)())) {
      await this.deps.funnel.bump(TOUR_VERSION, null, 'completed');
      await this.deps.funnel.bump(TOUR_VERSION, null, 'import_tapped');
    }
  }
}
