import { describe, it, expect } from 'vitest';
import { runConcernsCheck, parseConcernsArgs, formatConcerns, CONCERNS_FORMAT_SQL } from './concerns-format-check.js';

/**
 * [P90-4 · owner, Prompt 88] How many stored notes hold a concern that is not plain text (the old demo-seed shape,
 * `{ text }`, crashed the pre-meeting brief)? Counts only, no content: one READ ONLY transaction, one SELECT, refuses
 * --apply.
 */
const fake = (row: Record<string, unknown>) => {
  const seen: string[] = [];
  return { seen, query: async (sql: string) => { seen.push(sql); return { rows: sql === CONCERNS_FORMAT_SQL ? [row] : [] }; } };
};

describe('[P90-4] concerns format check', () => {
  it('one read-only transaction with a single SELECT, rolled back', async () => {
    const c = fake({ notes: '3', items: '5', accounts: '2', not_a_list: '1', notes_checked: '40' });
    const r = await runConcernsCheck(c);
    expect(c.seen).toEqual(['BEGIN TRANSACTION READ ONLY', CONCERNS_FORMAT_SQL, 'ROLLBACK']);
    expect(CONCERNS_FORMAT_SQL.trim()).toMatch(/^SELECT/i);
    expect(CONCERNS_FORMAT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(r).toEqual({ notes: 3, items: 5, accounts: 2, notAList: 1, notesChecked: 40 });
  });
  it('NEGATIVE: the query returns counts only: no note text, no concern text, no email, no id', () => {
    const selected = CONCERNS_FORMAT_SQL.slice(0, CONCERNS_FORMAT_SQL.search(/\bFROM\b/i));
    expect(selected).not.toMatch(/raw_text|email|c\.value\b(?!\))|n\.id\b(?!\))|user_id\b(?!\))/i);
    expect([...selected.matchAll(/\bAS (\w+)/gi)].map((m) => m[1])).toEqual(['notes', 'items', 'accounts', 'not_a_list', 'notes_checked']);
    for (const col of selected.split(',')) expect(col).toMatch(/count\(/i);
  });
  it('prints numbers and labels only', () => {
    expect(formatConcerns({ notes: 0, items: 0, accounts: 0, notAList: 0, notesChecked: 12 })).toEqual([
      'notes checked (with an extraction): 12',
      'notes with a concern that is not plain text: 0',
      'such concerns in total: 0',
      'accounts they belong to: 0',
      'notes whose concerns field is not a list: 0',
    ]);
  });
  it('NEGATIVE: refuses --apply and any other argument', () => {
    expect(() => parseConcernsArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseConcernsArgs(['--x'])).toThrow(/unknown argument/);
    expect(parseConcernsArgs([])).toEqual({});
  });
});
