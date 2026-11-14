import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, runMigrations } from '../db/migrate.js';
import { PgUserRepository } from '../adapters/auth/pg-user-repository.js';
import { PgClientRepository } from '../adapters/clients/pg-client-repository.js';
import { PgNoteRepository } from '../adapters/notes/pg-note-repository.js';
import { PgFactsRepository } from '../adapters/facts/pg-facts-repository.js';
import { PgRequirementRepository } from '../adapters/requirements/pg-requirement-repository.js';
import { runPregnancyPurge, formatPurge } from './pregnancy-purge.js';

/**
 * [P69-17 · owner] The prod dry run found nothing (accounts 0). Prove that's because there is nothing, not because the
 * purge is blind: in a real Postgres with every migration applied, plant one of each the way the product stores them
 * (written through the Pg repositories, as data stored before the P69-14 block existed) and run the same dry run.
 *   a detail "Expecting a baby"  → 1 detail deleted
 *   an ask "Hybrid after the baby" → 1 ask cut
 *   a key date "Due date"         → 1 date deleted
 *   a receipt quote "after the baby I'd want hybrid" on a promise → 1 quote blanked
 * plus controls that must be left alone. Then --apply, and nothing pregnancy-related is left in the database.
 * Gated on MIGRATIONS_TEST_DB_URL (CI's migrations-pg job sets it); it uses its own database so it never touches the
 * migrations test's schema.
 */
const ADMIN_URL = process.env.MIGRATIONS_TEST_DB_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const DB = 'tovira_pregnancy_purge_test';
const PREGNANCY = /pregnan|baby|expecting|"due date"/i; // the bare "Due date" value; the control "Payment due date" stays

suite('[P69-17] pregnancy-purge finds planted pregnancy details in real Postgres', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let userId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    const c = await pool.connect();
    try { await runMigrations(c, loadMigrations(fileURLToPath(new URL('../../migrations', import.meta.url)))); } finally { c.release(); }

    const users = new PgUserRepository(pool);
    userId = (await users.create({ email: 'purge-test@example.com', passwordHash: 'x', referralCode: 'PURGE1' })).id;
    const client = await new PgClientRepository(pool).create(userId, 'Sana Iqbal');
    const notes = new PgNoteRepository(pool);
    const note = await notes.create(userId, { clientId: client.id, source: 'paste', rawText: "after the baby I'd want hybrid", audioKey: null, status: 'extracted' } as never);

    const promises = [
      { text: 'Send the hybrid policy', owner: 'rep' as const, due_date: null, due_raw: null, confidence: 'high' as const, source_span: "after the baby I'd want hybrid", source_message_at: null },
      { text: 'Send the proposal by Friday', owner: 'rep' as const, due_date: null, due_raw: 'Friday', confidence: 'high' as const, source_span: 'I will send the proposal by Friday', source_message_at: null }, // control
    ];
    const keyDates = [
      { description: 'Due date', date: null, date_raw: 'March', type: 'other', source_span: null, source_message_at: null },
      { description: 'Payment due date', date: null, date_raw: 'the 30th', type: 'deadline', source_span: null, source_message_at: null }, // control
    ];
    const requirements = [{ text: 'Hybrid after the baby', requirement_raw: 'wants hybrid', stated_on: null, confidence: 'low' as const }];
    await notes.update(userId, note.id, { extracted: {
      summary: 'Talked about her next role.', people: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [], promises, key_dates: keyDates, requirements,
      personal_facts: [
        { subject: 'Sana Iqbal', fact: 'Expecting a baby', category: 'family', source_span: null, source_message_at: null },
        { subject: 'Sana Iqbal', fact: 'Loves the beach', category: 'hobby', source_span: null, source_message_at: null }, // control
      ],
    } as never });
    await new PgFactsRepository(pool).saveExtraction(userId, { noteId: note.id, clientId: client.id, promises, keyDates, captureAt: '2026-11-08' });
    await new PgRequirementRepository(pool).saveForNote(userId, note.id, client.id, requirements.map((r) => ({ text: r.text, requirementRaw: r.requirement_raw, statedOn: r.stated_on, confidence: r.confidence, embedding: null })));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
  });

  async function stored(): Promise<string> {
    const q = async (sql: string) => JSON.stringify((await pool.query(sql)).rows);
    return [
      await q('SELECT extracted FROM notes'),
      await q('SELECT description, date_raw, source_span FROM key_dates'),
      await q('SELECT text, source_span FROM promises'),
      await q('SELECT text, requirement_raw FROM requirements'),
    ].join('\n');
  }

  it('the dry run finds each planted item, and changes nothing', async () => {
    const before = await stored();
    const c = await pool.connect();
    let r;
    try { r = await runPregnancyPurge(c, { apply: false }); } finally { c.release(); }
    console.log(formatPurge(r, false));
    expect(r).toEqual({
      accounts: 1, notes: 1,
      detailsDeleted: 1, detailsCut: 0,
      asksDeleted: 0, asksCut: 1,
      datesDeleted: 1, datesCut: 0,
      promisesBlanked: 0, quotesBlanked: 1,
      pointersDeleted: 0, pointersCut: 0,
    });
    expect(await stored()).toBe(before);
  });

  it('--apply leaves no pregnancy detail anywhere, keeps the controls and the hybrid ask, and audits counts only', async () => {
    const c = await pool.connect();
    try { await runPregnancyPurge(c, { apply: true }); } finally { c.release(); }
    const after = await stored();
    expect(after).not.toMatch(PREGNANCY);
    expect(after).toContain('Loves the beach');
    expect(after).toContain('Payment due date');
    expect(after).toContain('Send the proposal by Friday');
    expect((await pool.query('SELECT text, requirement_raw FROM requirements')).rows).toEqual([{ text: 'Hybrid', requirement_raw: 'wants hybrid' }]);
    expect((await pool.query("SELECT source_span FROM promises WHERE text = 'Send the hybrid policy'")).rows).toEqual([{ source_span: "[health detail redacted] I'd want hybrid" }]);
    const audit = (await pool.query('SELECT requester_names, categories FROM erasure_audit')).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.requester_names).toEqual([]);
    expect(JSON.stringify(audit[0]!.categories)).not.toMatch(PREGNANCY);
  });
});
