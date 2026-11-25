import { describe, it, expect } from 'vitest';
import { runExposureCheck, parseExposureArgs, formatExposure, EXPOSURE_COUNTS_SQL, EXPOSURE_STATUS_SQL, EXPOSURE_ACCOUNTS_SQL } from './erasure-exposure-check.js';

/**
 * [P88-1 · owner] Was any erasure restriction ever open in prod, and which accounts exist. One READ ONLY transaction,
 * three SELECTs, emails redacted, refuses --apply.
 */
const fake = () => {
  const seen: string[] = [];
  return {
    seen,
    query: async (sql: string) => {
      seen.push(sql);
      if (sql === EXPOSURE_COUNTS_SQL) return { rows: [{ requests: '0', receipts: '0', audits: '0' }] };
      if (sql === EXPOSURE_STATUS_SQL) return { rows: [] };
      if (sql === EXPOSURE_ACCOUNTS_SQL) return { rows: [{ email: 'someone@example.com', created_at: '2026-10-01T08:00:00Z' }] };
      return { rows: [] };
    },
  };
};

describe('[P88-1] erasure exposure check', () => {
  it('one read-only transaction of SELECTs only, rolled back', async () => {
    const c = fake();
    const r = await runExposureCheck(c);
    expect(c.seen).toEqual(['BEGIN TRANSACTION READ ONLY', EXPOSURE_COUNTS_SQL, EXPOSURE_STATUS_SQL, EXPOSURE_ACCOUNTS_SQL, 'ROLLBACK']);
    for (const sql of [EXPOSURE_COUNTS_SQL, EXPOSURE_STATUS_SQL, EXPOSURE_ACCOUNTS_SQL]) {
      expect(sql.trim()).toMatch(/^SELECT/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    }
    expect(r).toMatchObject({ requests: 0, receipts: 0, audits: 0, byStatus: [] });
  });

  it('never prints a whole email address', async () => {
    const lines = formatExposure(await runExposureCheck(fake())).join('\n');
    expect(lines).not.toContain('someone@example.com');
    expect(lines).toMatch(/accounts: 1/);
    expect(lines).toMatch(/created 2026-10-01/);
  });

  it('prints every status when requests exist', () => {
    expect(formatExposure({ requests: 2, receipts: 1, audits: 1, byStatus: [{ status: 'completed', n: 1 }, { status: 'withdrawn', n: 1 }], accounts: [] })[0])
      .toBe('erasure requests stored (all statuses): 2 (completed 1, withdrawn 1)');
  });

  it('NEGATIVE: refuses --apply or any other argument', () => {
    expect(parseExposureArgs([])).toEqual({});
    expect(() => parseExposureArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseExposureArgs(['--only-user', 'x'])).toThrow();
  });
});
