/**
 * [P87-1 · owner, 25 Nov] "Make the date quirk impossible, not just absent in prod." node-pg parses a Postgres DATE
 * into a JS Date at LOCAL midnight; read back with toISOString() on a host east of UTC, every stored day came back
 * one day early (2026-12-01 -> 2026-11-30). Prod and CI are UTC, so nothing showed. This file runs under
 * TZ=Asia/Dubai (UTC+4) and proves a stored date round-trips unchanged through the pool every API process, the
 * migration runner and every owner-run script use (createPool), for each DATE column the app reads.
 * The real-Postgres part is gated on MIGRATIONS_TEST_DB_URL (the CI migrations-pg job sets it).
 */
const PRIOR_TZ = process.env.TZ;
process.env.TZ = 'Asia/Dubai';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPool } from './pool.js';
import { pgDay } from './pg-date.js';
import { loadMigrations, runMigrations } from './migrate.js';
import { PgUserRepository } from '../adapters/auth/pg-user-repository.js';
import { PgClientRepository } from '../adapters/clients/pg-client-repository.js';
import { PgNoteRepository } from '../adapters/notes/pg-note-repository.js';
import { PgFactsRepository } from '../adapters/facts/pg-facts-repository.js';
import { PgRequirementRepository } from '../adapters/requirements/pg-requirement-repository.js';
import { PgPrioritiesRepository } from '../adapters/priorities/pg-priorities-repository.js';

/** Edge days: a month end, a year start, a leap day, and the first day of a month. */
afterAll(() => { // do not leak Dubai time into other test files sharing this worker
  if (PRIOR_TZ === undefined) delete process.env.TZ; else process.env.TZ = PRIOR_TZ;
});

const DAYS = ['2026-12-01', '2027-01-01', '2028-02-29', '2026-11-30'];

describe('[P87-1] the test really runs east of UTC', () => {
  it('Asia/Dubai is in force (UTC+4), so a local-midnight Date would read the day before', () => {
    expect(new Date(2026, 11, 1).getTimezoneOffset()).toBe(-240);
    expect(new Date(2026, 11, 1).toISOString().slice(0, 10)).toBe('2026-11-30'); // the old bug, demonstrated
  });

  it('pgDay reads a DATE correctly in either shape: text, or node-pg\'s local-midnight Date', () => {
    for (const d of DAYS) {
      const [y, m, day] = d.split('-').map(Number);
      expect(pgDay(d)).toBe(d);
      expect(pgDay(new Date(y!, m! - 1, day!))).toBe(d);
    }
    expect(pgDay(null)).toBeNull();
  });
});

const ADMIN_URL = process.env.MIGRATIONS_TEST_DB_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const DB = 'tovira_p87_date_test';

suite('[P87-1] a stored DATE round-trips unchanged under TZ=Asia/Dubai, on real Postgres', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let userId: string;
  let clientId: string;
  let noteId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    pool = createPool(url.toString());
    pool.on('error', () => {}); // [P87] teardown drops this database WITH (FORCE): a connection still closing is ended (57P01), which node-pg raises on the pool. Not a test result.
    const c = await pool.connect();
    try { await runMigrations(c, loadMigrations(fileURLToPath(new URL('../../migrations', import.meta.url)))); } finally { c.release(); }
    userId = (await new PgUserRepository(pool).create({ email: 'p87@example.com', passwordHash: 'x', referralCode: 'P87A' })).id;
    clientId = (await new PgClientRepository(pool).create(userId, 'Omar Haddad')).id;
    noteId = (await new PgNoteRepository(pool).create(userId, { clientId, source: 'paste', rawText: 'n', audioKey: null, status: 'extracted' })).id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin?.end();
  });

  it('the shared pool hands back a DATE as the text Postgres stored, never a Date', async () => {
    const { rows } = await pool.query(`SELECT $1::date AS d, ARRAY[$1::date, $2::date] AS ds`, [DAYS[0], DAYS[2]]);
    expect(rows[0].d).toBe(DAYS[0]);
    expect(rows[0].ds).toEqual([DAYS[0], DAYS[2]]);
  });

  it('promises.due_date and key_dates.date come back as stored', async () => {
    const facts = new PgFactsRepository(pool);
    await facts.saveExtraction(userId, {
      noteId, clientId,
      promises: DAYS.map((d, i) => ({ text: `Promise ${i}`, owner: 'rep' as const, due_date: d, due_raw: d, confidence: 'high' as const, source_span: `promise ${i}`, source_message_at: null })),
      keyDates: DAYS.map((d, i) => ({ description: `Date ${i}`, date: d, date_raw: d, type: 'deadline' as const, source_span: `date ${i}`, source_message_at: null })),
    });
    const promises = await facts.listPromisesByUser(userId);
    expect(promises.map((p) => p.dueDate).sort()).toEqual([...DAYS].sort());
    const dates = await facts.listKeyDatesByUser(userId);
    expect(dates.map((d) => d.date).sort()).toEqual([...DAYS].sort());
  });

  it('requirements.stated_on comes back as stored', async () => {
    const reqs = new PgRequirementRepository(pool);
    await reqs.saveForNote(userId, noteId, clientId, DAYS.map((d, i) => ({ text: `Need ${i}`, requirementRaw: `need ${i}`, statedOn: d, confidence: 'high' as const, embedding: null })));
    expect((await reqs.listByClient(userId, clientId)).map((r) => r.statedOn).sort()).toEqual([...DAYS].sort());
  });

  it('daily_priorities.day comes back as stored', async () => {
    const pri = new PgPrioritiesRepository(pool);
    await pri.save(userId, DAYS[0]!, [], 0);
    expect((await pri.get(userId, DAYS[0]!))?.day).toBe(DAYS[0]);
  });
});
