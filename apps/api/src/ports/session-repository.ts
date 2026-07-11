/**
 * Port: server-side session store. Opaque tokens (not JWTs) so logout can truly
 * invalidate a session server-side. Local dev = Postgres (or in-memory in tests).
 */

export interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<SessionRecord>;
  find(token: string): Promise<SessionRecord | null>;
  delete(token: string): Promise<void>;
}
