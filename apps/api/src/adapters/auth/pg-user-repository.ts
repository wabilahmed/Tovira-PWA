import type { Pool } from 'pg';
import type { CreateUserInput, UserRecord, UserRepository } from '../../ports/user-repository.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at.getTime(),
  };
}

/** Postgres-backed user store (the real, durable source of truth). */
export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
      [email],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, created_at`,
      [input.email, input.passwordHash],
    );
    return toRecord(rows[0]!);
  }

  async delete(id: string): Promise<void> {
    // FK ON DELETE CASCADE removes every tenant table + training log for this user.
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
  }
}
