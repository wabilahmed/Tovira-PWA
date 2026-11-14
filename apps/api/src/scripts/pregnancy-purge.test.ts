import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPregnancyPurge, parsePregnancyPurgeArgs, PURGE_SQL } from './pregnancy-purge.js';
import { RECRUITMENT_RUNS } from '../test-support/recruitment-card.fixture.js';

/**
 * [P69-15 · owner] Purge stored pregnancy details from every account, with the store-time block's cut. The dry run
 * changes nothing; --apply hard-deletes items with nothing meaningful left, cuts mixed ones, blanks quotes, in one
 * transaction, and records an erasure_audit row per account with counts only. Output is counts only.
 */
type Row = Record<string, unknown>;
const U = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

function fakeDb(rows: Partial<Record<keyof typeof PURGE_SQL, Row[]>>) {
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      sent.push({ sql, params });
      const key = (Object.keys(PURGE_SQL) as Array<keyof typeof PURGE_SQL>).find((k) => PURGE_SQL[k] === sql);
      return { rows: key ? rows[key] ?? [] : [] };
    },
  };
  return { db, sent, writes: () => sent.filter((s) => /^(UPDATE|DELETE|INSERT)/.test(s.sql)) };
}

const PREGNANCY = /pregnan|baby|expecting|maternity|paternity|fertility|ivf/i;
const recruitment = () => ({
  notes: RECRUITMENT_RUNS.map((ex, i) => ({ id: `n${i}`, user_id: U, extracted: ex })),
  requirements: [
    { id: 'r1', user_id: U, text: 'Hybrid arrangement after the baby', requirement_raw: "after the baby I'd want hybrid" },
    { id: 'r2', user_id: U2, text: 'Expecting a baby', requirement_raw: 'expecting a baby' },
  ],
  keyDates: [{ id: 'k1', user_id: U2, description: 'Baby due', date_raw: 'March', source_span: 'the baby is due in March' }],
  promises: [{ id: 'p1', user_id: U, source_span: "after the baby I'd want hybrid" }],
  pointers: [{ user_id: U, client_id: 'c1', pointers: [{ text: 'Offer hybrid after the baby', receipts: [{ source_span: "after the baby I'd want hybrid" }] }] }],
});

describe('[P69-15] pregnancy-purge', () => {
  it('the dry run counts and changes nothing (READ ONLY, rolled back)', async () => {
    const { db, sent, writes } = fakeDb(recruitment());
    const r = await runPregnancyPurge(db, { apply: false });
    expect(sent[0]!.sql).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sent.at(-1)!.sql).toBe('ROLLBACK');
    expect(writes()).toEqual([]);
    // [P69-17 · owner] counts are now by kind, each item once (a date/ask/promise is counted on its row, not its JSON copy).
    // Details (JSON): runs 1-4 delete "Expecting a baby", run 5 cuts its fact and blanks its quote. Rows: ask r1 cut (quote
    // blanked), ask r2 deleted, key date k1 deleted, promise p1 quote blanked, the pointer cut (quote blanked).
    expect(r).toEqual({ accounts: 2, notes: 5, detailsDeleted: 4, detailsCut: 1, asksDeleted: 1, asksCut: 1, datesDeleted: 1, datesCut: 0, promisesBlanked: 0, quotesBlanked: 4, pointersDeleted: 0, pointersCut: 1 });
  });

  it('--apply leaves no pregnancy word in anything it writes, in one transaction', async () => {
    const { db, sent, writes } = fakeDb(recruitment());
    await runPregnancyPurge(db, { apply: true });
    expect(sent[0]!.sql).toBe('BEGIN');
    expect(sent.at(-1)!.sql).toBe('COMMIT');
    for (const w of writes()) expect(JSON.stringify(w.params), w.sql).not.toMatch(PREGNANCY);
    const sqls = writes().map((w) => `${w.sql.split(' ').slice(0, w.sql.startsWith('DELETE') ? 3 : 2).join(' ')} ${w.params[0]}`);
    expect(sqls).toEqual(expect.arrayContaining(['DELETE FROM key_dates k1', 'DELETE FROM requirements r2', 'UPDATE requirements r1', 'UPDATE promises p1']));
    const r1 = writes().find((w) => w.sql.startsWith('UPDATE requirements'))!;
    expect(r1.params.slice(1)).toEqual(['Hybrid arrangement', "[health detail redacted] I'd want hybrid"]);
    expect(r1.sql).toContain('embedding = NULL'); // its vector came from the removed words
  });

  it('keeps hybrid in every Recruitment note it rewrites', async () => {
    const { db, writes } = fakeDb(recruitment());
    await runPregnancyPurge(db, { apply: true });
    const notes = writes().filter((w) => w.sql.startsWith('UPDATE notes')).map((w) => JSON.parse(String(w.params[1])));
    expect(notes).toHaveLength(5);
    for (const ex of notes) expect(JSON.stringify([ex.personal_facts, ex.requirements])).toMatch(/hybrid/i);
  });

  it('records an erasure_audit row per account with counts only (no names, no content)', async () => {
    const { db, writes } = fakeDb(recruitment());
    await runPregnancyPurge(db, { apply: true });
    const audits = writes().filter((w) => w.sql.startsWith('INSERT INTO erasure_audit'));
    expect(audits.map((a) => a.params[0])).toEqual([U, U2]);
    for (const a of audits) {
      expect(a.params[1]).toEqual([]);
      for (const c of JSON.parse(String(a.params[2]))) expect(Object.keys(c).sort()).toEqual(['category', 'deleted']);
    }
  });

  it('leaves rows that only matched the loose SQL prefilter untouched', async () => {
    const { db, writes } = fakeDb({ notes: [{ id: 'n', user_id: U, extracted: { personal_facts: [{ subject: 'A', fact: 'Expecting the proposal by Friday', category: 'preference' }] } }], requirements: [{ id: 'r', user_id: U, text: 'Has a baby daughter, wants a garden', requirement_raw: 'we have a baby daughter' }] });
    expect(await runPregnancyPurge(db, { apply: true })).toEqual({ accounts: 0, notes: 0, detailsDeleted: 0, detailsCut: 0, asksDeleted: 0, asksCut: 0, datesDeleted: 0, datesCut: 0, promisesBlanked: 0, quotesBlanked: 0, pointersDeleted: 0, pointersCut: 0 });
    expect(writes()).toEqual([]);
  });

  it('rolls back and writes no audit when a write fails', async () => {
    const { db, sent } = fakeDb(recruitment());
    const failing = { query: async (sql: string, p?: unknown[]) => { if (sql.startsWith('DELETE FROM requirements')) throw new Error('boom'); return db.query(sql, p); } };
    await expect(runPregnancyPurge(failing, { apply: true })).rejects.toThrow('boom');
    expect(sent.at(-1)!.sql).toBe('ROLLBACK');
    expect(sent.some((s) => s.sql.startsWith('INSERT INTO erasure_audit'))).toBe(false);
  });

  it('takes only --apply, and the prod runner knows the script', () => {
    expect(parsePregnancyPurgeArgs([])).toEqual({ apply: false });
    expect(parsePregnancyPurgeArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parsePregnancyPurgeArgs(['--only', 'x'])).toThrow();
    const runner = readFileSync(fileURLToPath(new URL('../../../../scripts/ops/run-backfill.sh', import.meta.url)), 'utf8');
    expect(runner).toContain('pregnancy-purge) SCRIPT_IN_IMAGE="apps/api/src/scripts/pregnancy-purge.ts"');
  });
});
