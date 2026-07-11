import type { Pool } from 'pg';
import type { SessionRecord, SessionRepository } from '../../ports/session-repository.js';

interface SessionRow {
  token: string;
  user_id: string;
  expires_at: Date;
}

/** Postgres-backed session store so logout truly invalidates server-side. */
export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(session: SessionRecord): Promise<SessionRecord> {
    await this.pool.query(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))',
      [session.token, session.userId, session.expiresAt],
    );
    return session;
  }

  async find(token: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<SessionRow>(
      'SELECT token, user_id, expires_at FROM sessions WHERE token = $1',
      [token],
    );
    const row = rows[0];
    return row ? { token: row.token, userId: row.user_id, expiresAt: row.expires_at.getTime() } : null;
  }

  async delete(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }
}
