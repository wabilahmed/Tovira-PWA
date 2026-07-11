import { randomBytes } from 'node:crypto';
import type { UserRepository, UserRecord } from '../../ports/user-repository.js';
import type { SessionRepository } from '../../ports/session-repository.js';
import type { PasswordHasher } from './password.js';

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export class AuthValidationError extends AuthError {
  override name = 'AuthValidationError';
  constructor(message: string) {
    super(400, message);
  }
}
export class EmailInUseError extends AuthError {
  override name = 'EmailInUseError';
  constructor() {
    super(409, 'That email is already registered.');
  }
}
export class InvalidCredentialsError extends AuthError {
  override name = 'InvalidCredentialsError';
  constructor() {
    // Deliberately generic — must NOT reveal whether the email exists.
    super(401, 'Invalid email or password.');
  }
}

export interface PublicUser {
  id: string;
  email: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresAt: number;
}

export interface Identity {
  userId: string;
}

export interface AuthServiceDeps {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  sessionTtlMs: number;
  now?: () => number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  private readonly deps: AuthServiceDeps;
  private readonly now: () => number;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  async signup(emailRaw: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new AuthValidationError('A valid email is required.');
    if (!password || password.length < 8) {
      throw new AuthValidationError('Password must be at least 8 characters.');
    }
    if (await this.deps.users.findByEmail(email)) throw new EmailInUseError();

    const passwordHash = await this.deps.hasher.hash(password);
    const user = await this.deps.users.create({ email, passwordHash });
    return this.issue(user);
  }

  async login(emailRaw: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailRaw);
    const user = await this.deps.users.findByEmail(email);
    // Always run a verify (even on unknown email) to avoid a timing oracle, and
    // fail with one generic error for both cases — no user enumeration.
    const ok = await this.deps.hasher.verify(password, user?.passwordHash ?? 'scrypt$00$00');
    if (!user || !ok) throw new InvalidCredentialsError();
    return this.issue(user);
  }

  async authenticate(token: string): Promise<Identity | null> {
    if (!token) return null;
    const session = await this.deps.sessions.find(token);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      await this.deps.sessions.delete(token);
      return null;
    }
    return { userId: session.userId };
  }

  async logout(token: string): Promise<void> {
    if (token) await this.deps.sessions.delete(token);
  }

  async getPublicUser(userId: string): Promise<PublicUser | null> {
    const user = await this.deps.users.findById(userId);
    return user ? { id: user.id, email: user.email } : null;
  }

  get sessionTtlSeconds(): number {
    return Math.floor(this.deps.sessionTtlMs / 1000);
  }

  private async issue(user: UserRecord): Promise<AuthResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.deps.sessionTtlMs;
    await this.deps.sessions.create({ token, userId: user.id, expiresAt });
    return { user: { id: user.id, email: user.email }, token, expiresAt };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
