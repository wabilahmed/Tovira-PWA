import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';

// [RECEIPTS-v0.9.5] 0064 adds the per-fact receipt columns additively. A live Postgres can't be assumed
// in CI, so the schema shape is asserted STATICALLY over the real .sql (same pattern as inventory-
// migration.test.ts); the in-memory test confirms current v0.9.4 writes are unaffected.
const SQL = readFileSync(fileURLToPath(new URL('../../migrations/0064_fact_receipts.sql', import.meta.url)), 'utf8');

describe('[RECEIPTS-v0.9.5] 0064 adds nullable receipt columns, additively and reversibly', () => {
  for (const table of ['promises', 'key_dates', 'meetings']) {
    it(`${table}: adds source_span + source_message_at`, () => {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS source_span text`));
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS source_message_at timestamptz`));
    });
  }

  it('the new columns are NULLABLE — no NOT NULL and no DEFAULT (so existing rows/writes are unaffected)', () => {
    // Every ADD COLUMN line for the receipt fields must not carry NOT NULL or DEFAULT.
    for (const m of SQL.matchAll(/ADD COLUMN IF NOT EXISTS (source_span|source_message_at)[^,\n]*/g)) {
      expect(m[0]).not.toMatch(/NOT NULL/i);
      expect(m[0]).not.toMatch(/DEFAULT/i);
    }
  });

  it('is purely additive → reversible: only ADD COLUMN, no DROP/UPDATE/DELETE/constraint on data', () => {
    expect(SQL).not.toMatch(/DROP TABLE/i);
    expect(SQL).not.toMatch(/\bUPDATE\b/i); // no backfill / data transform
    expect(SQL).not.toMatch(/\bDELETE\b/i);
    // The reverse is documented for the operator.
    expect(SQL).toMatch(/REVERSE \(down-migration\)/);
    expect(SQL).toMatch(/DROP COLUMN IF EXISTS source_span/);
  });

  it('existing v0.9.4 extraction still writes correctly — facts save with no receipt fields set', async () => {
    // v0.9.4 output carries no source_span/source_message_at; the current save path is unchanged and the
    // facts persist + read back. (The new columns simply default NULL in Postgres.)
    const facts = new InMemoryFactsRepository();
    await facts.saveExtraction('user-A', {
      noteId: 'n1', clientId: 'c1',
      promises: [{ text: 'send quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high' }],
      keyDates: [{ description: 'renewal', date: null, date_raw: 'June', type: 'deadline' }],
    });
    const promises = await facts.listPromisesByUser('user-A');
    expect(promises).toHaveLength(1);
    expect(promises[0]!.text).toBe('send quote');
    // No receipt field leaked into the current shape.
    expect((promises[0] as unknown as Record<string, unknown>).source_span).toBeUndefined();
  });
});
