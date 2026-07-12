/**
 * Port: durable user store. Local dev = Postgres (or in-memory in tests);
 * the server is the source of truth. Email is stored normalized (lowercased).
 */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  /** Delete the user (and, on Postgres, cascade all their data). */
  delete(id: string): Promise<void>;
}
