import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrate.js';
import { PgUserRepository } from '../adapters/auth/pg-user-repository.js';
import { PgClientRepository } from '../adapters/clients/pg-client-repository.js';
import { PgNoteRepository } from '../adapters/notes/pg-note-repository.js';
import { PgFactsRepository } from '../adapters/facts/pg-facts-repository.js';
import { PgRequirementRepository } from '../adapters/requirements/pg-requirement-repository.js';
import { PgRecallSessionRepository } from '../adapters/recall/pg-recall-session-repository.js';
import { PgImageRepository } from '../adapters/images/pg-image-repository.js';
import { PgNoteSweepSource } from '../adapters/notes/pg-note-sweep-source.js';

/**
 * [P86 · index audit] The N+1 rewrites, proven on REAL Postgres (the in-memory adapters never run this SQL).
 * Saving a note's facts was one INSERT per promise and per key date, saving requirements one INSERT each, the recall
 * export one SELECT per session, and every-client reads one SELECT per client. Each is now one statement; these
 * tests pin that the result is exactly what the loop produced: the same rows, the same dedupe onto an open
 * canonical, the same date filled from a duplicate, the same order. Gated on MIGRATIONS_TEST_DB_URL (CI sets it).
 */
const ADMIN_URL = process.env.MIGRATIONS_TEST_DB_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const DB = 'tovira_p86_batched_test';

suite('[P86] batched reads and writes behave as the loops did, on real Postgres', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let userId: string;
  let clientId: string;
  let otherClientId: string;
  let noteId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    const c = await pool.connect();
    try { await runMigrations(c, loadMigrations(fileURLToPath(new URL('../../migrations', import.meta.url)))); } finally { c.release(); }
    userId = (await new PgUserRepository(pool).create({ email: 'p86@example.com', passwordHash: 'x', referralCode: 'P86A' })).id;
    const clients = new PgClientRepository(pool);
    clientId = (await clients.create(userId, 'Omar Haddad')).id;
    otherClientId = (await clients.create(userId, 'Sara Khan')).id;
    noteId = (await new PgNoteRepository(pool).create(userId, { clientId, source: 'paste', rawText: 'n', audioKey: null, status: 'extracted' })).id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin?.end();
  });

  const p = (text: string, due_date: string | null, extra: Record<string, unknown> = {}) => ({ text, owner: 'rep' as const, due_date, due_raw: due_date ? 'Thursday' : null, confidence: 'high' as const, source_span: `I'll ${text.toLowerCase()}`, source_message_at: null, ...extra });

  it('saveExtraction: dedupes onto an open canonical, fills its date from a duplicate, within the note too; idempotent per note', async () => {
    const facts = new PgFactsRepository(pool);
    const notes = new PgNoteRepository(pool);
    // an earlier note left an open, undated canonical "Send the revised quote"
    const earlier = (await notes.create(userId, { clientId, source: 'paste', rawText: 'e', audioKey: null, status: 'extracted' })).id;
    await facts.saveExtraction(userId, { noteId: earlier, clientId, promises: [p('Send the revised quote', null)] });
    const canonical = (await pool.query(`SELECT id FROM promises WHERE note_id = $1`, [earlier])).rows[0].id as string;

    const input = {
      noteId, clientId, captureAt: '2026-11-24',
      promises: [
        p('Send the revised quote', '2026-11-27'), // duplicate of the earlier canonical, with a date
        p('Book the viewing', null, { date_status: 'to_confirm' }), // new canonical, undated
        p('Book the viewing', '2026-11-28'), // duplicate within this note, with a date
        p('Share the floor plan', '2026-11-26'),
      ],
      keyDates: [
        { description: 'Launch', date: '2027-03-03', date_raw: 'March 3rd 2027', type: 'launch', source_span: 'launch is 3 March 2027', source_message_at: null },
        { description: 'Board meeting', date: null, date_raw: 'the 20th', type: 'deadline', source_span: null, source_message_at: null },
      ],
    };
    for (let run = 0; run < 2; run++) {
      await facts.saveExtraction(userId, input);
      const rows = (await pool.query(
        `SELECT id, text, merged_into, due_date::text AS due, due_raw, date_status, capture_at FROM promises WHERE note_id = $1 ORDER BY text, merged_into NULLS FIRST`, [noteId])).rows;
      expect(rows).toHaveLength(4);
      const viewing = rows.filter((r) => r.text === 'Book the viewing');
      expect(viewing[0].merged_into).toBeNull(); // the canonical
      expect(viewing[1].merged_into).toBe(viewing[0].id); // its duplicate, merged into it
      expect(viewing[0].due).toBe('2026-11-28'); // the specific date wins, filled from the duplicate
      expect(viewing[0].date_status).toBeNull(); // a date answers "to confirm"
      expect(rows.find((r) => r.text === 'Send the revised quote')!.merged_into).toBe(canonical);
      expect(rows.find((r) => r.text === 'Share the floor plan')!.merged_into).toBeNull();
      expect(rows.every((r) => r.capture_at === '2026-11-24')).toBe(true);
      const earlierRow = (await pool.query(`SELECT due_date::text AS due, due_raw FROM promises WHERE id = $1`, [canonical])).rows[0];
      expect(earlierRow).toEqual({ due: '2026-11-27', due_raw: 'Thursday' }); // the earlier canonical got the date
      const kd = (await pool.query(`SELECT description, date::text AS date, date_raw, type, source_span FROM key_dates WHERE note_id = $1 ORDER BY description`, [noteId])).rows;
      expect(kd).toEqual([
        { description: 'Board meeting', date: null, date_raw: 'the 20th', type: 'deadline', source_span: null },
        { description: 'Launch', date: '2027-03-03', date_raw: 'March 3rd 2027', type: 'launch', source_span: 'launch is 3 March 2027' },
      ]);
    }
    // an empty extraction clears the note's rows
    await facts.saveExtraction(userId, { noteId, clientId, promises: [], keyDates: [] });
    expect((await pool.query(`SELECT count(*)::int AS n FROM promises WHERE note_id = $1`, [noteId])).rows[0].n).toBe(0);
  });

  it('saveForNote: returns the saved requirements in input order, embeddings stored, replacing the note\'s earlier ones', async () => {
    const reqs = new PgRequirementRepository(pool);
    const vec = Array.from({ length: 512 }, (_, i) => (i % 7) / 7);
    await reqs.saveForNote(userId, noteId, clientId, [{ text: 'Old', requirementRaw: 'old', statedOn: null, confidence: 'low', embedding: null }]);
    const saved = await reqs.saveForNote(userId, noteId, clientId, [
      { text: 'A 2-bed near the marina', requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-11-24', confidence: 'high', embedding: vec },
      { text: 'Two units', requirementRaw: "if the budget clears she'd take two units", statedOn: null, confidence: 'low', embedding: null },
    ]);
    expect(saved.map((r) => [r.text, r.requirementRaw, r.statedOn === null, r.confidence, r.embedded, r.noteId, r.clientId])).toEqual([
      ['A 2-bed near the marina', 'looking for a 2-bed near the marina', false, 'high', true, noteId, clientId],
      ['Two units', "if the budget clears she'd take two units", true, 'low', false, noteId, clientId],
    ]);
    // the stored date itself, read as text (node-pg maps a `date` to local midnight, so a non-UTC host reads it a day off)
    expect((await pool.query(`SELECT stated_on::text AS d FROM requirements WHERE id = $1`, [saved[0]!.id])).rows[0].d).toBe('2026-11-24');
    expect((await reqs.listByClient(userId, clientId)).map((r) => r.text).sort()).toEqual(['A 2-bed near the marina', 'Two units']);
    expect(await reqs.saveForNote(userId, noteId, clientId, [])).toEqual([]);
  });

  it('recall export: every session in order, each with its messages in order (one query)', async () => {
    const recall = new PgRecallSessionRepository(pool);
    const s1 = await recall.activeSession(userId, Date.parse('2026-11-01T10:00:00Z'), 60_000);
    await recall.appendMessage(userId, s1, 'user', 'what did Omar want?', 0);
    await recall.appendMessage(userId, s1, 'assistant', 'A 2-bed near the marina.', 0);
    const s2 = await recall.activeSession(userId, Date.parse('2026-11-02T10:00:00Z'), 60_000);
    const out = await recall.exportForUser(userId);
    expect(out.map((s) => s.id)).toEqual([s1, s2]);
    expect(out[0]!.messages.map((m) => [m.role, m.content])).toEqual([['user', 'what did Omar want?'], ['assistant', 'A 2-bed near the marina.']]);
    expect(out[1]!.messages).toEqual([]);
  });

  it('listByClients (notes, requirements, images): each client\'s rows exactly as listByClient returns them', async () => {
    const notes = new PgNoteRepository(pool);
    await notes.create(userId, { clientId: otherClientId, source: 'paste', rawText: 'other', audioKey: null, status: 'extracted' });
    await notes.create(userId, { clientId: otherClientId, source: 'paste', rawText: 'unconfirmed', audioKey: null, status: 'pending_confirmation' });
    const images = new PgImageRepository(pool);
    await images.create(userId, { clientId, storageKey: 'images/x', contentType: 'image/jpeg' });
    const reqs = new PgRequirementRepository(pool);
    const ids = [clientId, otherClientId, '00000000-0000-0000-0000-000000000000'];
    for (const repo of [notes, reqs, images] as Array<{ listByClient(u: string, c: string): Promise<unknown[]>; listByClients(u: string, ids: string[]): Promise<Map<string, unknown[]>> }>) {
      const batch = await repo.listByClients(userId, ids);
      for (const id of ids) expect(batch.get(id)).toEqual(await repo.listByClient(userId, id));
    }
  });

  it('the sweep\'s "who has work" names only reps with a note in flight, including a stale extracting claim', async () => {
    const users = new PgUserRepository(pool);
    const idle = (await users.create({ email: 'idle@example.com', passwordHash: 'x', referralCode: 'P86B' })).id;
    const busy = (await users.create({ email: 'busy@example.com', passwordHash: 'x', referralCode: 'P86C' })).id;
    const crashed = (await users.create({ email: 'crashed@example.com', passwordHash: 'x', referralCode: 'P86D' })).id;
    const clients = new PgClientRepository(pool);
    const notes = new PgNoteRepository(pool);
    await notes.create(idle, { clientId: (await clients.create(idle, 'A')).id, source: 'paste', rawText: 'x', audioKey: null, status: 'extracted' });
    await notes.create(busy, { clientId: (await clients.create(busy, 'B')).id, source: 'paste', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    const cn = await notes.create(crashed, { clientId: (await clients.create(crashed, 'C')).id, source: 'paste', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    const now = Date.now();
    await notes.claimForExtraction(crashed, cn.id, now - 11 * 60_000); // claimed 11 minutes ago and never finished
    const who = await new PgNoteSweepSource(pool).usersWithWork(now, 10 * 60_000);
    expect(who).toContain(busy);
    expect(who).toContain(crashed);
    expect(who).not.toContain(idle);
    const fresh = await new PgNoteSweepSource(pool).usersWithWork(now - 5 * 60_000, 10 * 60_000); // 6 minutes old then: not stale
    expect(fresh).not.toContain(crashed);
  });
});
