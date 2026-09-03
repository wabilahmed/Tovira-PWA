/**
 * Port: conversational Ask sessions (feat(ASK-SESSION)). Per rep (not per client — a rep may ask
 * about several clients in one conversation). Tenant-scoped; the Postgres impl enforces RLS.
 * History is conversational continuity ONLY — never a source of truth.
 */

export type RecallRole = 'user' | 'assistant';

export interface RecallMessage {
  role: RecallRole;
  content: string;
  createdAt: number;
}

export interface RecallSessionExport {
  id: string;
  createdAt: number;
  messages: RecallMessage[];
}

export interface RecallSessionRepository {
  /** The rep's active session — the most recent one whose last activity is within `idleMs` — else a
   *  new one; bumps last-activity to `nowMs`. A gap ≥ idleMs starts a fresh session (30 min default). */
  activeSession(userId: string, nowMs: number, idleMs: number): Promise<string>;
  appendMessage(userId: string, sessionId: string, role: RecallRole, content: string, nowMs: number): Promise<void>;
  /** The last `n` messages of a session, chronological (oldest → newest). */
  recentMessages(userId: string, sessionId: string, n: number): Promise<RecallMessage[]>;
  /** Every session + its messages for the rep — included in account export (the rep's own data). */
  exportForUser(userId: string): Promise<RecallSessionExport[]>;
  /** Remove the rep's sessions + messages on account delete (pg also cascades on the users FK). */
  purgeUser(userId: string): Promise<void>;
}
