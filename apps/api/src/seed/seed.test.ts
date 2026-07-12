import { describe, it, expect } from 'vitest';
import { seedDatabase } from './seed.js';
import { fixtures } from './fixtures.js';

interface Recorded {
  sql: string;
  params?: unknown[];
}

class FakeDb {
  queries: Recorded[] = [];
  async query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push({ sql, params });
    // The user upsert resolves the demo user id.
    if (/RETURNING id/i.test(sql)) return { rows: [{ id: 'demo-user-id' }] };
    return { rows: [] };
  }
}

// A fast fake so tests don't run real scrypt.
const hasher = { hash: async () => 'hash', verify: async () => true };

describe('seedDatabase', () => {
  it('upserts the demo user, every client and every note', async () => {
    const db = new FakeDb();
    const summary = await seedDatabase(db, { hasher });
    expect(summary.clients).toBe(fixtures.clients.length);
    expect(summary.notes).toBe(fixtures.notes.length);
    expect(summary.userId).toBe('demo-user-id');
  });

  // NEGATIVE: "Run seed twice → no duplicate/inconsistent data (idempotent)."
  it('makes every insert idempotent with ON CONFLICT', async () => {
    const db = new FakeDb();
    await seedDatabase(db, { hasher });
    const inserts = db.queries.filter((q) => /INSERT INTO/i.test(q.sql));
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert.sql, insert.sql).toMatch(/ON CONFLICT/i);
    }
  });

  it('inserts clients and notes owned by the resolved demo user', async () => {
    const db = new FakeDb();
    await seedDatabase(db, { hasher });
    const clientInserts = db.queries.filter((q) => /INSERT INTO clients/i.test(q.sql));
    const noteInserts = db.queries.filter((q) => /INSERT INTO notes/i.test(q.sql));
    expect(clientInserts.length).toBe(fixtures.clients.length);
    expect(noteInserts.length).toBe(fixtures.notes.length);
    for (const q of [...clientInserts, ...noteInserts]) {
      expect(q.params).toContain('demo-user-id');
    }
  });

  it('never stores the demo password in plaintext', async () => {
    const db = new FakeDb();
    await seedDatabase(db, { hasher });
    const userInsert = db.queries.find((q) => /INSERT INTO users/i.test(q.sql))!;
    expect(userInsert.params).not.toContain(fixtures.user.password);
  });
});
