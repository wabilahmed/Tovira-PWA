import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { InMemoryMeetingRepository } from './in-memory-meeting-repository.js';
import { PgMeetingRepository } from './pg-meeting-repository.js';
import type { NewMeeting } from '../../ports/meeting-repository.js';

/**
 * [RECEIPTS-v0.9.5 Task 2] source_span / source_message_at persist through the meetings repo
 * and read back — including the ambiguous-source (null timestamp) case.
 */

const CHAT_MSG_AT = '2026-09-14T10:01:00.000Z';
const newMeeting = (over: Partial<NewMeeting>): NewMeeting => ({
  clientId: 'c1', datetime: null, datetimeRaw: 'Thursday 3pm', title: null, confirmed: false,
  sourceSpan: 'meeting Thursday 3pm at your office', sourceMessageAt: CHAT_MSG_AT, ...over,
});

function fakePool(respond: (sql: string, params: unknown[]) => Array<Record<string, unknown>> = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: respond(sql, params) }; },
    release: () => {},
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

describe('[RECEIPTS-v0.9.5 Task 2] meeting persistence — in-memory round-trip', () => {
  it('persists and reads back both receipt fields', async () => {
    const repo = new InMemoryMeetingRepository();
    const m = await repo.create('u', newMeeting({}));
    expect(m.sourceSpan).toBe('meeting Thursday 3pm at your office');
    expect(m.sourceMessageAt).toBe(CHAT_MSG_AT);
    const read = await repo.findByIdForUser('u', m.id);
    expect(read!.sourceSpan).toBe('meeting Thursday 3pm at your office');
    expect(read!.sourceMessageAt).toBe(CHAT_MSG_AT);
  });

  it('ambiguous source (voice/paste): span persists, source_message_at is NULL', async () => {
    const repo = new InMemoryMeetingRepository();
    const m = await repo.create('u', newMeeting({ sourceMessageAt: null }));
    expect(m.sourceSpan).toBe('meeting Thursday 3pm at your office');
    expect(m.sourceMessageAt).toBeNull();
  });
});

describe('[RECEIPTS-v0.9.5 Task 2] meeting persistence — Postgres INSERT/read contract (fake pool)', () => {
  // Return a row echoing the INSERT params so create's RETURNING → toRecord round-trips.
  const rowFromInsert = (params: unknown[]): Record<string, unknown> => ({
    id: 'm-1', user_id: params[0], client_id: params[1], datetime: params[2] ? new Date(params[2] as string) : null,
    datetime_raw: params[3], title: params[4], confirmed: params[5], note_id: params[6] ?? null, nudged_at: null,
    source_span: params[7] ?? null, source_message_at: params[8] ? new Date(params[8] as string) : null, created_at: new Date(),
  });

  it('the meetings INSERT names both receipt columns, binds their values, and reads them back', async () => {
    const { pool, calls } = fakePool((sql, params) => (sql.includes('INSERT INTO meetings') ? [rowFromInsert(params)] : []));
    const rec = await new PgMeetingRepository(pool).create('u', newMeeting({}));
    const ins = calls.find((c) => c.sql.includes('INSERT INTO meetings'))!;
    expect(ins.sql).toContain('source_span');
    expect(ins.sql).toContain('source_message_at');
    // params: […, note_id($7), source_span($8), source_message_at($9)]
    expect(ins.params[7]).toBe('meeting Thursday 3pm at your office');
    expect(ins.params[8]).toBe(CHAT_MSG_AT);
    // read-back via RETURNING → toRecord
    expect(rec.sourceSpan).toBe('meeting Thursday 3pm at your office');
    expect(rec.sourceMessageAt).toBe(new Date(CHAT_MSG_AT).toISOString());
  });

  it('ambiguous source binds source_message_at as NULL', async () => {
    const { pool, calls } = fakePool((sql, params) => (sql.includes('INSERT INTO meetings') ? [rowFromInsert(params)] : []));
    const rec = await new PgMeetingRepository(pool).create('u', newMeeting({ sourceMessageAt: null }));
    const ins = calls.find((c) => c.sql.includes('INSERT INTO meetings'))!;
    expect(ins.params[7]).toBe('meeting Thursday 3pm at your office');
    expect(ins.params[8]).toBeNull();
    expect(rec.sourceMessageAt).toBeNull();
  });
});
