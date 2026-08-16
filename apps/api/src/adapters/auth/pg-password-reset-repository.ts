import type { Pool } from 'pg';
import type { PasswordResetRecord, PasswordResetRepository } from '../../ports/password-reset-repository.js';

/** Postgres-backed reset-token store (system table; only the hash is stored). */
export class PgPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly pool: Pool) {}

  async create(record: PasswordResetRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [record.tokenHash, record.userId, record.expiresAt],
    );
  }

  async consume(tokenHash: string, nowMs: number): Promise<string | null> {
    // Atomically mark used only if still valid+unused; RETURNING gives the userId.
    const { rows } = await this.pool.query<{ user_id: string }>(
      `UPDATE password_resets SET used = true
       WHERE token_hash = $1 AND used = false AND expires_at > to_timestamp($2 / 1000.0)
       RETURNING user_id`,
      [tokenHash, nowMs],
    );
    return rows[0]?.user_id ?? null;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
  }
}
