/**
 * [P45-1] The admin plane: Tovira's operator accounts. NOT reps. Separate tables on the OWNER pool (never granted to
 * the app role), separate sessions and cookie, so an admin has no client book, trial, billing or allowance, never
 * appears in rep counts, and a rep route can never accept an admin session.
 */
export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string | null;
  /** The enrolled TOTP secret, encrypted (AES-256-GCM, key outside the database). */
  totpSecretEnc: string | null;
  /** A secret shown during enrolment, not yet confirmed with a code. */
  totpPendingEnc: string | null;
  totpEnrolledAt: number | null;
  /** The last TOTP step accepted (a code is never accepted twice). */
  totpLastStep: number | null;
  createdAt: number;
}

export interface AdminSession {
  tokenHash: string;
  adminId: string;
  /** False until the second factor is done: such a session can only enrol or verify. */
  mfaOk: boolean;
  lastSeenAt: number;
  createdAt: number;
}

export interface AdminAuditEntry { adminEmail: string; action: string; target: string | null; detail: Record<string, unknown> | null; at: number }

export interface AdminStore {
  findUserByEmail(email: string): Promise<AdminUser | null>;
  findUserById(id: string): Promise<AdminUser | null>;
  /** [P46-6c.1] Every admin (a handful): the deploy-time TOTP re-encryption walks them. */
  listUsers(): Promise<AdminUser[]>;
  createUser(email: string, at: number): Promise<AdminUser>;
  updateUser(id: string, patch: Partial<Pick<AdminUser, 'passwordHash' | 'totpSecretEnc' | 'totpPendingEnc' | 'totpEnrolledAt' | 'totpLastStep'>>): Promise<void>;
  createInvite(tokenHash: string, adminId: string, expiresAt: number): Promise<void>;
  /** Single use: returns the admin id once for an unexpired, unconsumed token, else null. */
  consumeInvite(tokenHash: string, now: number): Promise<string | null>;
  createSession(s: AdminSession): Promise<void>;
  findSession(tokenHash: string): Promise<AdminSession | null>;
  touchSession(tokenHash: string, at: number): Promise<void>;
  markSessionMfa(tokenHash: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  replaceRecoveryCodes(adminId: string, codeHashes: string[]): Promise<void>;
  /** Consumes one unused recovery code; true if it matched. */
  useRecoveryCode(adminId: string, codeHash: string, at: number): Promise<boolean>;
  audit(e: AdminAuditEntry): Promise<void>;
  listAudit(limit: number): Promise<AdminAuditEntry[]>;
}
