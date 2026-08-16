/**
 * Port: single-use, expiring password-reset tokens. The RAW token is emailed;
 * only its hash is stored, so a leaked DB never yields a usable token. Consuming
 * a token marks it used (single-use); all of a user's tokens are invalidated on
 * a successful reset or a password change.
 */
export interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
}

export interface PasswordResetRepository {
  create(record: PasswordResetRecord): Promise<void>;
  /** If a valid, unexpired, UNUSED token matches, mark it used and return its
   *  userId; otherwise null (expired / reused / unknown all look identical). */
  consume(tokenHash: string, nowMs: number): Promise<string | null>;
  /** Invalidate every reset token for a user (on reset or password change). */
  deleteForUser(userId: string): Promise<void>;
}
