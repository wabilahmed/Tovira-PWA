import type { Pool } from 'pg';
import type { AdminAuditEntry, AdminSession, AdminStore, AdminUser } from '../../ports/admin.js';

interface UserRow { id: string; email: string; password_hash: string | null; totp_secret_enc: string | null; totp_pending_enc: string | null; totp_enrolled_at: Date | null; totp_last_step: string | null; created_at: Date }
const toUser = (r: UserRow): AdminUser => ({
  id: r.id, email: r.email, passwordHash: r.password_hash, totpSecretEnc: r.totp_secret_enc, totpPendingEnc: r.totp_pending_enc,
  totpEnrolledAt: r.totp_enrolled_at?.getTime() ?? null, totpLastStep: r.totp_last_step === null ? null : Number(r.totp_last_step), createdAt: r.created_at.getTime(),
});
const USER_COLS = 'id, email, password_hash, totp_secret_enc, totp_pending_enc, totp_enrolled_at, totp_last_step, created_at';
const ts = (ms: number) => new Date(ms).toISOString();

/** [P45-1] The admin plane on the OWNER pool (never granted to tovira_app). */
export class PgAdminStore implements AdminStore {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<AdminUser | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT ${USER_COLS} FROM admin_users WHERE email = $1`, [email.toLowerCase()]);
    return rows[0] ? toUser(rows[0]) : null;
  }
  async listUsers(): Promise<AdminUser[]> {
    const { rows } = await this.pool.query<UserRow>(`SELECT ${USER_COLS} FROM admin_users ORDER BY created_at`);
    return rows.map(toUser);
  }

  async findUserById(id: string): Promise<AdminUser | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT ${USER_COLS} FROM admin_users WHERE id = $1`, [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }
  async createUser(email: string, at: number): Promise<AdminUser> {
    const { rows } = await this.pool.query<UserRow>(`INSERT INTO admin_users (email, created_at) VALUES ($1, $2) RETURNING ${USER_COLS}`, [email.toLowerCase(), ts(at)]);
    return toUser(rows[0]!);
  }
  async updateUser(id: string, patch: Partial<Pick<AdminUser, 'passwordHash' | 'totpSecretEnc' | 'totpPendingEnc' | 'totpEnrolledAt' | 'totpLastStep'>>): Promise<void> {
    const map: Record<string, [string, (v: unknown) => unknown]> = {
      passwordHash: ['password_hash', (v) => v], totpSecretEnc: ['totp_secret_enc', (v) => v], totpPendingEnc: ['totp_pending_enc', (v) => v],
      totpEnrolledAt: ['totp_enrolled_at', (v) => (v === null ? null : ts(v as number))], totpLastStep: ['totp_last_step', (v) => v],
    };
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) { const m = map[k]; if (!m) continue; vals.push(m[1](v)); sets.push(`${m[0]} = $${vals.length}`); }
    if (sets.length) await this.pool.query(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = $1`, vals);
  }
  async createInvite(tokenHash: string, adminId: string, expiresAt: number): Promise<void> {
    await this.pool.query('INSERT INTO admin_invites (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, adminId, ts(expiresAt)]);
  }
  async consumeInvite(tokenHash: string, now: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ admin_id: string }>(
      'UPDATE admin_invites SET consumed_at = $2 WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at >= $2 RETURNING admin_id', [tokenHash, ts(now)]);
    return rows[0]?.admin_id ?? null;
  }
  async createSession(s: AdminSession): Promise<void> {
    await this.pool.query('INSERT INTO admin_sessions (token_hash, admin_id, mfa_ok, last_seen_at, created_at) VALUES ($1, $2, $3, $4, $5)', [s.tokenHash, s.adminId, s.mfaOk, ts(s.lastSeenAt), ts(s.createdAt)]);
  }
  async findSession(tokenHash: string): Promise<AdminSession | null> {
    const { rows } = await this.pool.query<{ token_hash: string; admin_id: string; mfa_ok: boolean; last_seen_at: Date; created_at: Date }>(
      'SELECT token_hash, admin_id, mfa_ok, last_seen_at, created_at FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, adminId: r.admin_id, mfaOk: r.mfa_ok, lastSeenAt: r.last_seen_at.getTime(), createdAt: r.created_at.getTime() } : null;
  }
  async touchSession(tokenHash: string, at: number): Promise<void> { await this.pool.query('UPDATE admin_sessions SET last_seen_at = $2 WHERE token_hash = $1', [tokenHash, ts(at)]); }
  async markSessionMfa(tokenHash: string): Promise<void> { await this.pool.query('UPDATE admin_sessions SET mfa_ok = true WHERE token_hash = $1', [tokenHash]); }
  async deleteSession(tokenHash: string): Promise<void> { await this.pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]); }
  async replaceRecoveryCodes(adminId: string, codeHashes: string[]): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [adminId]);
      for (const h of codeHashes) await c.query('INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)', [adminId, h]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  async useRecoveryCode(adminId: string, codeHash: string, at: number): Promise<boolean> {
    const { rowCount } = await this.pool.query('UPDATE admin_recovery_codes SET used_at = $3 WHERE admin_id = $1 AND code_hash = $2 AND used_at IS NULL', [adminId, codeHash, ts(at)]);
    return (rowCount ?? 0) > 0;
  }
  async audit(e: AdminAuditEntry): Promise<void> {
    await this.pool.query('INSERT INTO admin_audit (admin_email, action, target, detail, at) VALUES ($1, $2, $3, $4, $5)', [e.adminEmail, e.action, e.target, e.detail ? JSON.stringify(e.detail) : null, ts(e.at)]);
  }
  async listAudit(limit: number): Promise<AdminAuditEntry[]> {
    const { rows } = await this.pool.query<{ admin_email: string; action: string; target: string | null; detail: Record<string, unknown> | null; at: Date }>(
      'SELECT admin_email, action, target, detail, at FROM admin_audit ORDER BY at DESC, id DESC LIMIT $1', [limit]);
    return rows.map((r) => ({ adminEmail: r.admin_email, action: r.action, target: r.target, detail: r.detail, at: r.at.getTime() }));
  }
}
