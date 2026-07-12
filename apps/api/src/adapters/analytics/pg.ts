import type { Pool } from 'pg';
import type { ActivationRepository, Analytics, AnalyticsEvent } from '../../services/analytics/activation-service.js';

/** Records activation on users.activated_at; the UPDATE ... WHERE NULL is atomic. */
export class PgActivationRepository implements ActivationRepository {
  constructor(private readonly pool: Pool) {}
  async markActivatedOnce(userId: string, at: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      'UPDATE users SET activated_at = to_timestamp($2 / 1000.0) WHERE id = $1 AND activated_at IS NULL RETURNING id',
      [userId, at],
    );
    return rows.length > 0;
  }
}

/** Logs analytics events (a real pipeline is wired at deploy). No client PII. */
export class LogAnalytics implements Analytics {
  async track(event: AnalyticsEvent): Promise<void> {
    console.log(`[analytics] ${event.event} user=${event.userId}`);
  }
}
