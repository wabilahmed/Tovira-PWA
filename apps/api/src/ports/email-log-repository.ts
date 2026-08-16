/**
 * Port: idempotency log for lifecycle emails — one email per (user, eventKey).
 * A replayed webhook or a re-run scheduler must never double-send.
 */
export interface EmailLogRepository {
  /** Record (userId, eventKey) if absent; returns true only the first time. */
  recordIfAbsent(userId: string, eventKey: string): Promise<boolean>;
}
