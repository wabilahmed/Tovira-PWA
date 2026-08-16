/**
 * Port: single-use, expiring email-verification tokens (soft verification). Only
 * the token HASH is stored; the raw token lives in the email link.
 */
export interface EmailVerificationRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export interface EmailVerificationRepository {
  create(record: EmailVerificationRecord): Promise<void>;
  /** If a valid, unexpired, UNUSED token matches, mark it used and return its
   *  userId; otherwise null (expired / reused / unknown look identical). */
  consume(tokenHash: string, nowMs: number): Promise<string | null>;
  /** Count tokens created for a user since `sinceMs` — the resend rate limit. */
  countCreatedSince(userId: string, sinceMs: number): Promise<number>;
}
