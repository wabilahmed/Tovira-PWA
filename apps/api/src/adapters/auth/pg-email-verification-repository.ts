import type { Pool } from 'pg';
import type { EmailVerificationRecord, EmailVerificationRepository } from '../../ports/email-verification-repository.js';

export class PgEmailVerificationRepository implements EmailVerificationRepository {
  constructor(private readonly pool: Pool) {}
  async create(r: EmailVerificationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_verifications (token_hash, user_id, expires_at, created_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))`,
      [r.tokenHash, r.userId, r.expiresAt, r.createdAt],
    );
  }
  async consume(tokenHash: string, nowMs: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `UPDATE email_verifications SET used = true
       WHERE token_hash = $1 AND used = false AND expires_at > to_timestamp($2 / 1000.0)
       RETURNING user_id`,
      [tokenHash, nowMs],
    );
    return rows[0]?.user_id ?? null;
  }
  async countCreatedSince(userId: string, sinceMs: number): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM email_verifications WHERE user_id = $1 AND created_at >= to_timestamp($2 / 1000.0)`,
      [userId, sinceMs],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
