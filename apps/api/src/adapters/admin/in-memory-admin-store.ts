import { randomUUID } from 'node:crypto';
import type { AdminAuditEntry, AdminSession, AdminStore, AdminUser } from '../../ports/admin.js';

/** [P45-1] In-memory admin plane for tests and local runs. */
export class InMemoryAdminStore implements AdminStore {
  readonly users = new Map<string, AdminUser>();
  readonly sessions = new Map<string, AdminSession>();
  private invites = new Map<string, { adminId: string; expiresAt: number; consumed: boolean }>();
  private codes = new Map<string, Array<{ hash: string; usedAt: number | null }>>();
  readonly auditLog: AdminAuditEntry[] = [];

  async findUserByEmail(email: string): Promise<AdminUser | null> {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async findUserById(id: string): Promise<AdminUser | null> { return this.users.get(id) ?? null; }
  async createUser(email: string, at: number): Promise<AdminUser> {
    const u: AdminUser = { id: randomUUID(), email: email.toLowerCase(), passwordHash: null, totpSecretEnc: null, totpPendingEnc: null, totpEnrolledAt: null, totpLastStep: null, createdAt: at };
    this.users.set(u.id, u);
    return u;
  }
  async updateUser(id: string, patch: Partial<AdminUser>): Promise<void> {
    const u = this.users.get(id);
    if (u) Object.assign(u, patch);
  }
  async createInvite(tokenHash: string, adminId: string, expiresAt: number): Promise<void> {
    this.invites.set(tokenHash, { adminId, expiresAt, consumed: false });
  }
  async consumeInvite(tokenHash: string, now: number): Promise<string | null> {
    const i = this.invites.get(tokenHash);
    if (!i || i.consumed || i.expiresAt < now) return null;
    i.consumed = true;
    return i.adminId;
  }
  async createSession(s: AdminSession): Promise<void> { this.sessions.set(s.tokenHash, { ...s }); }
  async findSession(tokenHash: string): Promise<AdminSession | null> { const s = this.sessions.get(tokenHash); return s ? { ...s } : null; }
  async touchSession(tokenHash: string, at: number): Promise<void> { const s = this.sessions.get(tokenHash); if (s) s.lastSeenAt = at; }
  async markSessionMfa(tokenHash: string): Promise<void> { const s = this.sessions.get(tokenHash); if (s) s.mfaOk = true; }
  async deleteSession(tokenHash: string): Promise<void> { this.sessions.delete(tokenHash); }
  async replaceRecoveryCodes(adminId: string, codeHashes: string[]): Promise<void> {
    this.codes.set(adminId, codeHashes.map((hash) => ({ hash, usedAt: null })));
  }
  async useRecoveryCode(adminId: string, codeHash: string, at: number): Promise<boolean> {
    const c = (this.codes.get(adminId) ?? []).find((x) => x.hash === codeHash && x.usedAt === null);
    if (!c) return false;
    c.usedAt = at;
    return true;
  }
  async audit(e: AdminAuditEntry): Promise<void> { this.auditLog.push({ ...e }); }
  async listAudit(limit: number): Promise<AdminAuditEntry[]> { return [...this.auditLog].sort((a, b) => b.at - a.at).slice(0, limit); }
}
