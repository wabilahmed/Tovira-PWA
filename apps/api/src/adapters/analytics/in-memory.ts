import type { Analytics, AnalyticsEvent, ActivationRepository } from '../../services/analytics/activation-service.js';

/** In-memory analytics sink for tests (records events). */
export class InMemoryAnalytics implements Analytics {
  readonly events: AnalyticsEvent[] = [];
  async track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
  }
}

/** In-memory activation store for tests. */
export class InMemoryActivationRepository implements ActivationRepository {
  private activated = new Set<string>();
  async markActivatedOnce(userId: string): Promise<boolean> {
    if (this.activated.has(userId)) return false;
    this.activated.add(userId);
    return true;
  }
}
