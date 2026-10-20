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
  /** Terms acceptance evidence (P5-4): when the rep accepted, which version, and from which IP, or null
   *  for an account that never saw a terms screen. Renamed from consent_* — these record acceptance of
   *  contractual terms, NOT "consent" as a PDPL lawful basis. */
  termsAcceptedAt: number | null;
  termsVersionAccepted: string | null;
  termsAcceptedIp: string | null;
  emailVerified: boolean;
  /** IANA timezone (NUDGE-TZ) — "2 hours before" needs a clock. Defaults to Asia/Dubai. */
  timezone: string;
  createdAt: number;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  referralCode: string;
  termsAcceptedAt?: number | null;
  termsVersionAccepted?: string | null;
  termsAcceptedIp?: string | null;
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
  /** [P36-5] The rep's UI preferences (validated by the caller); '{}' when none saved. */
  getUiPrefs(id: string): Promise<Record<string, unknown>>;
  /** [P37] The required tour's state on the account. */
  getTour(id: string): Promise<TourRecord>;
  /** [P37] Save the step reached (for a tour version); raises max_step when higher. Returns the previous max. */
  setTourStep(id: string, version: number, step: number): Promise<{ previousMax: number }>;
  /** [P37] Mark the tour version completed (first time only). Returns true when it newly completed. */
  completeTour(id: string, version: number, atMs: number): Promise<boolean>;
  updateUiPrefs(id: string, prefs: Record<string, unknown>): Promise<void>;
  /** Mark the email verified (soft verification). */
  markEmailVerified(id: string): Promise<void>;
  /** Delete the user (and, on Postgres, cascade all their data). */
  delete(id: string): Promise<void>;
  /** All user ids — used by the nightly priorities precompute job (P4b-3). */
  listAllIds(): Promise<string[]>;
}

/** [P37] The tour on the account: the version completed (null = never), when, and where the rep is. */
export interface TourRecord {
  completedAt: number | null;
  completedVersion: number | null;
  step: number;
  /** The tour version the stored step belongs to (null = none yet). */
  stepVersion: number | null;
  /** Highest step reached for stepVersion (-1 = none). */
  maxStep: number;
}
