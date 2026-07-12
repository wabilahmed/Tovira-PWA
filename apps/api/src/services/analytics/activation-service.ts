/**
 * Activation & churn instrumentation (P7-3). Activation = the rep views their
 * first useful brief within the trial. It must fire EXACTLY once (never double
 * counted on repeat views) and carry NO raw client PII — only the user id, event
 * name, and timestamp.
 */
export interface AnalyticsEvent {
  userId: string;
  event: string;
  at: number;
}

export interface Analytics {
  track(event: AnalyticsEvent): Promise<void>;
}

export interface ActivationRepository {
  /** Records the user as activated if not already; returns true only the FIRST time. */
  markActivatedOnce(userId: string, at: number): Promise<boolean>;
}

export class ActivationService {
  constructor(
    private readonly activations: ActivationRepository,
    private readonly analytics: Analytics,
  ) {}

  /** Called when a rep views a brief. Fires the activation event once. */
  async onBriefViewed(userId: string, nowMs: number): Promise<void> {
    const firstTime = await this.activations.markActivatedOnce(userId, nowMs);
    if (firstTime) {
      // No client data — just the event. PII stays out of the analytics pipeline.
      await this.analytics.track({ userId, event: 'activation.first_brief', at: nowMs });
    }
  }
}
