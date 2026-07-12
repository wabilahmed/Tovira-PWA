import { ScryptHasher, type PasswordHasher } from '../services/auth/password.js';
import { fixtures } from './fixtures.js';

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface SeedSummary {
  userEmail: string;
  userId: string;
  clients: number;
  notes: number;
}

/**
 * Load the demo fixtures. Idempotent: fixed UUIDs + ON CONFLICT upserts mean a
 * second run updates in place rather than duplicating. Runs as the DB owner
 * (superuser), so RLS is bypassed for seeding across the demo tenant.
 */
export async function seedDatabase(db: Queryable, deps: { hasher?: PasswordHasher } = {}): Promise<SeedSummary> {
  const hasher = deps.hasher ?? new ScryptHasher();
  const passwordHash = await hasher.hash(fixtures.user.password);

  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [fixtures.user.email, passwordHash],
  );
  const userId = String(rows[0]!.id);

  for (const client of fixtures.clients) {
    await db.query(
      `INSERT INTO clients (id, user_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, user_id = EXCLUDED.user_id`,
      [client.id, userId, client.name],
    );
  }

  for (const note of fixtures.notes) {
    await db.query(
      `INSERT INTO notes (id, user_id, client_id, source, raw_text, extracted)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_text = EXCLUDED.raw_text, extracted = EXCLUDED.extracted`,
      [note.id, userId, note.clientId, note.source, note.rawText, JSON.stringify(note.extracted)],
    );
  }

  return {
    userEmail: fixtures.user.email,
    userId,
    clients: fixtures.clients.length,
    notes: fixtures.notes.length,
  };
}
