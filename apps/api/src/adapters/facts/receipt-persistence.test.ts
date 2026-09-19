import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { InMemoryFactsRepository } from './in-memory-facts-repository.js';
import { PgFactsRepository } from './pg-facts-repository.js';
import { asExtraction } from '../../services/extraction/validate.js';
import type { ExtractedPromise, KeyDate } from '../../services/extraction/types.js';

/**
 * [RECEIPTS-v0.9.5 Task 2] source_span / source_message_at persist through the relational
 * spine (promises, key_dates) and read back — and, on an ambiguous source (voice/paste), the
 * span persists with source_message_at NULL (not dropped, not approximated). people and
 * personal_facts ride notes.extracted JSONB and carry the fields untouched (asExtraction spread).
 */

const CHAT_MSG_AT = '2026-09-14T10:01:00.000Z';
const withReceipt = (over: Partial<ExtractedPromise>): ExtractedPromise => ({
  text: 'Send the revised quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high',
  source_span: "I'll send the revised quote by Thursday", source_message_at: CHAT_MSG_AT, ...over,
});
const kdWithReceipt = (over: Partial<KeyDate>): KeyDate => ({
  description: 'Handover', date: null, date_raw: '3 March', type: 'deadline',
  source_span: 'handover is on the 3rd of March', source_message_at: CHAT_MSG_AT, ...over,
});

/** A minimal fake Pool for the withTenant path: records every query, returns caller-supplied rows. */
function fakePool(respond: (sql: string, params: unknown[]) => Array<Record<string, unknown>> = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: respond(sql, params) }; },
    release: () => {},
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}
const find = (calls: Array<{ sql: string; params: unknown[] }>, needle: string) => calls.find((c) => c.sql.includes(needle))!;

describe('[RECEIPTS-v0.9.5 Task 2] relational persistence — in-memory round-trip', () => {
  it('persists and reads back both receipt fields on a promise', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [withReceipt({})] });
    const [p] = await repo.listPromisesByNote('u', 'n1');
    expect(p!.sourceSpan).toBe("I'll send the revised quote by Thursday");
    expect(p!.sourceMessageAt).toBe(CHAT_MSG_AT);
  });

  it('persists and reads back both receipt fields on a key_date', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [], keyDates: [kdWithReceipt({})] });
    const [d] = await repo.listKeyDatesByNote('u', 'n1');
    expect(d!.sourceSpan).toBe('handover is on the 3rd of March');
    expect(d!.sourceMessageAt).toBe(CHAT_MSG_AT);
  });

  it('ambiguous source (voice/paste): span persists, source_message_at is NULL — not dropped, not approximated', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('u', { noteId: 'n1', clientId: 'c1',
      promises: [withReceipt({ source_message_at: null })],
      keyDates: [kdWithReceipt({ source_message_at: null })] });
    const [p] = await repo.listPromisesByNote('u', 'n1');
    const [d] = await repo.listKeyDatesByNote('u', 'n1');
    expect(p!.sourceSpan).toBe("I'll send the revised quote by Thursday");
    expect(p!.sourceMessageAt).toBeNull();
    expect(d!.sourceSpan).toBe('handover is on the 3rd of March');
    expect(d!.sourceMessageAt).toBeNull();
  });
});

describe('[RECEIPTS-v0.9.5 Task 2] relational persistence — Postgres INSERT/read contract (fake pool)', () => {
  it('the promises INSERT names both receipt columns and binds their values', async () => {
    const { pool, calls } = fakePool((sql) => (sql.includes('INSERT INTO promises') ? [{ id: 'p-1' }] : []));
    await new PgFactsRepository(pool).saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [withReceipt({})] });
    const ins = find(calls, 'INSERT INTO promises');
    expect(ins.sql).toContain('source_span');
    expect(ins.sql).toContain('source_message_at');
    // params: […, merged_into($9), source_span($10), source_message_at($11)]
    expect(ins.params[9]).toBe("I'll send the revised quote by Thursday");
    expect(ins.params[10]).toBe(CHAT_MSG_AT);
  });

  it('the key_dates INSERT names both receipt columns and binds their values', async () => {
    const { pool, calls } = fakePool();
    await new PgFactsRepository(pool).saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [], keyDates: [kdWithReceipt({})] });
    const ins = find(calls, 'INSERT INTO key_dates');
    expect(ins.sql).toContain('source_span');
    expect(ins.sql).toContain('source_message_at');
    // params: […, type($7), source_span($8), source_message_at($9)]
    expect(ins.params[7]).toBe('handover is on the 3rd of March');
    expect(ins.params[8]).toBe(CHAT_MSG_AT);
  });

  it('ambiguous source binds source_message_at as NULL, never a stand-in', async () => {
    const { pool, calls } = fakePool((sql) => (sql.includes('INSERT INTO promises') ? [{ id: 'p-1' }] : []));
    await new PgFactsRepository(pool).saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [withReceipt({ source_message_at: null })] });
    const ins = find(calls, 'INSERT INTO promises');
    expect(ins.params[9]).toBe("I'll send the revised quote by Thursday");
    expect(ins.params[10]).toBeNull();
  });

  it('the read path (toRecord) surfaces both fields from a stored row', async () => {
    const at = new Date(CHAT_MSG_AT);
    const row = { id: 'p-1', user_id: 'u', note_id: 'n1', client_id: 'c1', text: 'Send the revised quote', owner: 'rep',
      due_date: null, due_raw: 'Thursday', confidence: 'high', done: false, done_at: null, confirmed: false, merged_into: null,
      source_span: "I'll send the revised quote by Thursday", source_message_at: at, created_at: new Date() };
    const { pool } = fakePool((sql) => (sql.includes('FROM promises') ? [row] : []));
    const rec = await new PgFactsRepository(pool).getPromise('u', 'p-1');
    expect(rec!.sourceSpan).toBe("I'll send the revised quote by Thursday");
    expect(rec!.sourceMessageAt).toBe(at.toISOString());
  });
});

describe('[RECEIPTS-v0.9.5 Task 2] people/personal_facts carry the fields through the JSONB path (no repo change)', () => {
  it('asExtraction preserves source_span/source_message_at on people and personal_facts', () => {
    const raw = {
      summary: 's', promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
      people: [{ name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null,
        source_span: '[T1] Omar: any update?', source_message_at: CHAT_MSG_AT }],
      personal_facts: [{ subject: 'Omar', fact: 'Daughter started at LSE', category: 'family',
        source_span: 'my daughter just started at LSE', source_message_at: CHAT_MSG_AT }],
    };
    const ex = asExtraction(raw);
    expect(ex).not.toBeNull();
    expect(ex!.people[0]!.source_span).toBe('[T1] Omar: any update?');
    expect(ex!.people[0]!.source_message_at).toBe(CHAT_MSG_AT);
    expect(ex!.personal_facts[0]!.source_span).toBe('my daughter just started at LSE');
    expect(ex!.personal_facts[0]!.source_message_at).toBe(CHAT_MSG_AT);
  });
});
