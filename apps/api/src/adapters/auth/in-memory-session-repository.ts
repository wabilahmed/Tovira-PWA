import type { SessionRecord, SessionRepository } from '../../ports/session-repository.js';

/** In-memory session store for tests and quick local runs. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byToken = new Map<string, SessionRecord>();

  async create(session: SessionRecord): Promise<SessionRecord> {
    this.byToken.set(session.token, session);
    return session;
  }

  async find(token: string): Promise<SessionRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async delete(token: string): Promise<void> {
    this.byToken.delete(token);
  }
}
