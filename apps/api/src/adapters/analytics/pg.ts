import type { Pool } from 'pg';
import { PgUserRepository } from '../auth/pg-user-repository.js';
import type { ActivationRepository, Analytics, AnalyticsEvent } from '../../services/analytics/activation-service.js';

/** Records activation on users.activated_at. Delegates to PgUserRepository so ALL `users` SQL lives in
 *  one file ([USERS-GUARD]); this adapter holds no `users` query of its own. */
export class PgActivationRepository implements ActivationRepository {
  private readonly users: PgUserRepository;
  constructor(pool: Pool) {
    this.users = new PgUserRepository(pool);
  }
  markActivatedOnce(userId: string, at: number): Promise<boolean> {
    return this.users.markActivatedOnce(userId, at);
  }
}

/** Logs analytics events (a real pipeline is wired at deploy). No client PII. */
export class LogAnalytics implements Analytics {
  async track(event: AnalyticsEvent): Promise<void> {
    console.log(`[analytics] ${event.event} user=${event.userId}`);
  }
}
