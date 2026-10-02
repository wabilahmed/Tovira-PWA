import type { Pool, PoolClient } from 'pg';
import type { CreateUserInput, UserRecord, UserRepository } from '../../ports/user-repository.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  referral_code: string;
  terms_accepted_at: Date | null;
  terms_version_accepted: string | null;
  terms_accepted_ip: string | null;
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
    termsAcceptedAt: row.terms_accepted_at ? row.terms_accepted_at.getTime() : null,
    termsVersionAccepted: row.terms_version_accepted,
    termsAcceptedIp: row.terms_accepted_ip,
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
      'SELECT id, email, password_hash, referral_code, terms_accepted_at, terms_version_accepted, terms_accepted_ip, email_verified, timezone, created_at FROM users WHERE email = $1',
      [email],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, referral_code, terms_accepted_at, terms_version_accepted, terms_accepted_ip, email_verified, timezone, created_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByReferralCode(code: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, referral_code, terms_accepted_at, terms_version_accepted, terms_accepted_ip, email_verified, timezone, created_at FROM users WHERE referral_code = $1',
      [code],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, referral_code, terms_accepted_at, terms_version_accepted, terms_accepted_ip, timezone)
       VALUES ($1, $2, $3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4 / 1000.0) END, $5, $6, COALESCE($7, 'Asia/Dubai'))
       RETURNING id, email, password_hash, referral_code, terms_accepted_at, terms_version_accepted, terms_accepted_ip, email_verified, timezone, created_at`,
      [input.email, input.passwordHash, input.referralCode, input.termsAcceptedAt ?? null, input.termsVersionAccepted ?? null, input.termsAcceptedIp ?? null, input.timezone ?? null],
    );
    return toRecord(rows[0]!);
  }

  /**
   * [BETA-5] Create an invite-pending user ON A CALLER-SUPPLIED TRANSACTION CLIENT. Lives here so ALL
   * `users` SQL stays in this one audited file ([USERS-GUARD]); the approval tx runs it on its own client
   * so the user + invite + request flip commit atomically. The password hash is an unusable random one —
   * the account cannot be logged into until the invite is consumed (BETA-6). terms_* stay null (nothing
   * accepted yet); email_verified defaults false.
   */
  async createInvitedWithClient(client: PoolClient, email: string, passwordHash: string, referralCode: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, referral_code) VALUES ($1, $2, $3) RETURNING id`,
      [email, passwordHash, referralCode],
    );
    return rows[0]!.id;
  }

  /** [BETA-6] Set the password AND record terms acceptance in one statement, on a caller-supplied tx
   *  client — so invite consumption, password set, and request activation commit together. users SQL
   *  stays in this file ([USERS-GUARD]). */
  async setPasswordAndTermsWithClient(client: PoolClient, userId: string, passwordHash: string, termsVersion: string, termsAcceptedAt: number, termsAcceptedIp: string | null): Promise<void> {
    await client.query(
      `UPDATE users SET password_hash = $2, terms_version_accepted = $3,
         terms_accepted_at = to_timestamp($4 / 1000.0), terms_accepted_ip = $5
       WHERE id = $1`,
      [userId, passwordHash, termsVersion, termsAcceptedAt, termsAcceptedIp],
    );
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
    // FK ON DELETE CASCADE removes every tenant table + extraction log for this user.
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
