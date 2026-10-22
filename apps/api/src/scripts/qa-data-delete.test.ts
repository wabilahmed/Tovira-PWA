import { describe, it, expect, vi } from 'vitest';
import { parseQaAuditArgs, runQaDelete, QA_DELETE_LOOKUP_SQL } from './qa-data-audit.js';

/**
 * [P40-5] qa-data-audit --apply deletes ONLY the ids passed with --ids, in one transaction, and refuses (deleting
 * nothing) when any id is unknown, or is an access request that is activated or whose user account exists.
 * --ids without --apply is a dry run of exactly those ids.
 */
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
type Row = Record<string, unknown>;
function fakeDb(found: { clients?: Row[]; access?: Row[]; inventory?: Row[] }) {
  const sent: string[] = [];
  const db = { query: vi.fn(async (sql: string) => {
    sent.push(sql);
    if (sql === QA_DELETE_LOOKUP_SQL.clients) return { rows: found.clients ?? [] };
    if (sql === QA_DELETE_LOOKUP_SQL.access) return { rows: found.access ?? [] };
    if (sql === QA_DELETE_LOOKUP_SQL.inventory) return { rows: found.inventory ?? [] };
    return { rows: [], rowCount: 1 };
  }) };
  return { db, sent };
}

describe('[P40-5] qa-data-audit --apply --ids', () => {
  it('args: --apply needs --ids; ids must be uuids; --ids alone is a dry run', () => {
    expect(() => parseQaAuditArgs(['--apply'])).toThrow(/--ids/);
    expect(() => parseQaAuditArgs(['--apply', '--ids', 'not-a-uuid'])).toThrow(/uuid/);
    expect(parseQaAuditArgs(['--ids', `${ID(1)},${ID(2)}`])).toEqual({ apply: false, ids: [ID(1), ID(2)] });
    expect(parseQaAuditArgs(['--apply', '--ids', ID(1)])).toEqual({ apply: true, ids: [ID(1)] });
    expect(parseQaAuditArgs([])).toEqual({ apply: false, ids: null });
  });

  it('deletes exactly the given client + inventory ids in one transaction', async () => {
    const { db, sent } = fakeDb({ clients: [{ id: ID(1), name: 'QA Sara Khan' }], inventory: [{ id: ID(2), title: 'Sold out unit' }] });
    const r = await runQaDelete(db, [ID(1), ID(2)], true);
    expect(r.refused).toEqual([]);
    expect(r.deleted).toBe(2);
    expect(sent[0]).toBe('BEGIN');
    expect(sent.at(-1)).toBe('COMMIT');
    expect(sent.filter((q) => /^DELETE/.test(q))).toEqual(['DELETE FROM clients WHERE id = ANY($1::uuid[])', 'DELETE FROM inventory_items WHERE id = ANY($1::uuid[])']);
  });

  it('negative: an activated access request, or one whose user exists → the whole run is refused, nothing deleted', async () => {
    for (const a of [{ id: ID(3), full_name: 'QA One', status: 'activated', has_user: false }, { id: ID(3), full_name: 'QA Two', status: 'invited', has_user: true }]) {
      const { db, sent } = fakeDb({ clients: [{ id: ID(1), name: 'QA Sara Khan' }], access: [a] });
      const r = await runQaDelete(db, [ID(1), ID(3)], true);
      expect(r.deleted).toBe(0);
      expect(r.refused[0]).toMatch(/access request .* (activated|has a user account)/);
      expect(sent.some((q) => /^DELETE/.test(q))).toBe(false);
      expect(sent.at(-1)).toBe('ROLLBACK');
    }
  });

  it('negative: an unknown id refuses the run', async () => {
    const { db, sent } = fakeDb({ clients: [{ id: ID(1), name: 'QA Sara Khan' }] });
    const r = await runQaDelete(db, [ID(1), ID(9)], true);
    expect(r.refused).toEqual([`${ID(9)}: not a client, access request or inventory item`]);
    expect(sent.some((q) => /^DELETE/.test(q))).toBe(false);
  });

  it('a pending access request with no account is deletable', async () => {
    const { db } = fakeDb({ access: [{ id: ID(3), full_name: 'QA One', status: 'pending', has_user: false }] });
    expect((await runQaDelete(db, [ID(3)], true)).deleted).toBe(1);
  });

  it('dry run (no --apply): reads in a READ ONLY transaction, lists, deletes nothing', async () => {
    const { db, sent } = fakeDb({ clients: [{ id: ID(1), name: 'QA Sara Khan' }] });
    const r = await runQaDelete(db, [ID(1)], false);
    expect(r.wouldDelete).toEqual([`client ${ID(1)} "QA Sara Khan"`]);
    expect(sent[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sent.some((q) => /^DELETE/.test(q))).toBe(false);
    expect(sent.at(-1)).toBe('ROLLBACK');
  });
});
