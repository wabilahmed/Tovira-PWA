import type { Pool } from 'pg';
import type { EmailLogRepository } from '../../ports/email-log-repository.js';

export class PgEmailLogRepository implements EmailLogRepository {
  constructor(private readonly pool: Pool) {}
  async recordIfAbsent(userId: string, eventKey: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'INSERT INTO email_log (user_id, event_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, eventKey],
    );
    return (rowCount ?? 0) > 0;
  }
}
