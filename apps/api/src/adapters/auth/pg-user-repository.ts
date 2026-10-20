import type { Pool, PoolClient } from 'pg';
import type { CreateUserInput, TourRecord, UserRecord, UserRepository } from '../../ports/user-repository.js';

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

  async getUiPrefs(id: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{ ui_prefs: Record<string, unknown> | null }>('SELECT ui_prefs FROM users WHERE id = $1', [id]);
    return rows[0]?.ui_prefs ?? {};
  }

  async updateUiPrefs(id: string, prefs: Record<string, unknown>): Promise<void> {
    await this.pool.query('UPDATE users SET ui_prefs = $2::jsonb WHERE id = $1', [id, JSON.stringify(prefs)]);
  }

  async getTour(id: string): Promise<TourRecord> {
    const { rows } = await this.pool.query<{ tour_completed_at: Date | null; tour_version: number | null; tour_step: number; tour_step_version: number | null; tour_max_step: number }>(
      'SELECT tour_completed_at, tour_version, tour_step, tour_step_version, tour_max_step FROM users WHERE id = $1', [id]);
    const r = rows[0];
    return r
      ? { completedAt: r.tour_completed_at ? r.tour_completed_at.getTime() : null, completedVersion: r.tour_version, step: r.tour_step, stepVersion: r.tour_step_version, maxStep: r.tour_max_step }
      : { completedAt: null, completedVersion: null, step: 0, stepVersion: null, maxStep: -1 };
  }

  async setTourStep(id: string, version: number, step: number): Promise<{ previousMax: number }> {
    // One statement: the previous max (for this version) is read and raised atomically.
    const { rows } = await this.pool.query<{ previous_max: number }>(
      `UPDATE users u SET tour_step = $3, tour_step_version = $2,
         tour_max_step = GREATEST(CASE WHEN old.tour_step_version = $2 THEN old.tour_max_step ELSE -1 END, $3)
       FROM (SELECT id, tour_step_version, tour_max_step FROM users WHERE id = $1 FOR UPDATE) old
       WHERE u.id = old.id
       RETURNING CASE WHEN old.tour_step_version = $2 THEN old.tour_max_step ELSE -1 END AS previous_max`,
      [id, version, step],
    );
    return { previousMax: rows[0]?.previous_max ?? -1 };
  }

  async completeTour(id: string, version: number, atMs: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE users SET tour_completed_at = to_timestamp($3 / 1000.0), tour_version = $2 WHERE id = $1 AND (tour_version IS NULL OR tour_version < $2)',
      [id, version, atMs],
    );
    return (rowCount ?? 0) > 0;
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
