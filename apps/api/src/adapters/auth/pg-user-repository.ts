import type { Pool } from 'pg';
import type { CreateUserInput, UserRecord, UserRepository } from '../../ports/user-repository.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  referral_code: string;
  consent_at: Date | null;
  consent_version: string | null;
  email_verified: boolean;
  timezone: string;
  created_at: Date;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    referralCode: row.referral_code,
    consentAt: row.consent_at ? row.consent_at.getTime() : null,
    consentVersion: row.consent_version,
    emailVerified: row.email_verified,
    timezone: row.timezone,
    createdAt: row.created_at.getTime(),
  };
}

/** Postgres-backed user store (the real, durable source of truth). */
export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, referral_code, consent_at, consent_version, email_verified, timezone, created_at FROM users WHERE email = $1',
      [email],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, referral_code, consent_at, consent_version, email_verified, timezone, created_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByReferralCode(code: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, referral_code, consent_at, consent_version, email_verified, timezone, created_at FROM users WHERE referral_code = $1',
      [code],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, referral_code, consent_at, consent_version, timezone)
       VALUES ($1, $2, $3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4 / 1000.0) END, $5, COALESCE($6, 'Asia/Dubai'))
       RETURNING id, email, password_hash, referral_code, consent_at, consent_version, email_verified, timezone, created_at`,
      [input.email, input.passwordHash, input.referralCode, input.consentAt ?? null, input.consentVersion ?? null, input.timezone ?? null],
    );
    return toRecord(rows[0]!);
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }

  async updateTimezone(id: string, timezone: string): Promise<void> {
    await this.pool.query('UPDATE users SET timezone = $2 WHERE id = $1', [id, timezone]);
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.pool.query('UPDATE users SET email_verified = true WHERE id = $1', [id]);
  }

  async delete(id: string): Promise<void> {
    // FK ON DELETE CASCADE removes every tenant table + training log for this user.
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  /**
   * [SYSTEM-ONLY] The one deliberately UNSCOPED read of `users`. Returns ids ONLY (no PII) and is
   * called exclusively from SYSTEM/OPS contexts — the scheduled batch jobs (priorities/monday/daily
   * digest) and the ops spend report — NEVER from a rep-facing request path. `users` has no RLS (auth
   * must look a user up by email before any tenant context exists), so this cross-tenant read is safe
   * only because of that call-site discipline; the [USERS-GUARD] CI test enforces it (this is the sole
   * unscoped `FROM users` allowed anywhere). Do not call it from a request handler.
   */
  async listAllIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>('SELECT id FROM users');
    return rows.map((r) => r.id);
  }

  /** [ACTIVATION] Mark a user activated at most once (atomic UPDATE … WHERE activated_at IS NULL);
   *  returns true only on the first activation. Scoped by id. Lives here so ALL `users` SQL is in this
   *  one file ([USERS-GUARD]); the activation adapter delegates to it. */
  async markActivatedOnce(userId: string, at: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      'UPDATE users SET activated_at = to_timestamp($2 / 1000.0) WHERE id = $1 AND activated_at IS NULL RETURNING id',
      [userId, at],
    );
    return rows.length > 0;
  }
}
