/**
 * Port: durable user store. Local dev = Postgres (or in-memory in tests);
 * the server is the source of truth. Email is stored normalized (lowercased).
 */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  /** Opaque per-user code for the share/referral link — never the raw user id. */
  referralCode: string;
  /** When the rep accepted the terms + which policy version (P5-4), or null. */
  consentAt: number | null;
  consentVersion: string | null;
  emailVerified: boolean;
  /** IANA timezone (NUDGE-TZ) — "2 hours before" needs a clock. Defaults to Asia/Dubai. */
  timezone: string;
  createdAt: number;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  referralCode: string;
  consentAt?: number | null;
  consentVersion?: string | null;
  /** IANA timezone captured from the browser at signup; normalized to a valid zone or the default. */
  timezone?: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Resolve an opaque referral code to its user (P5-6), or null. */
  findByReferralCode(code: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  /** Set a new password hash (password reset). */
  updatePassword(id: string, passwordHash: string): Promise<void>;
  /** Update the rep's IANA timezone (Settings). Caller normalizes to a valid zone. */
  updateTimezone(id: string, timezone: string): Promise<void>;
  /** Mark the email verified (soft verification). */
  markEmailVerified(id: string): Promise<void>;
  /** Delete the user (and, on Postgres, cascade all their data). */
  delete(id: string): Promise<void>;
  /** All user ids — used by the nightly priorities precompute job (P4b-3). */
  listAllIds(): Promise<string[]>;
}
