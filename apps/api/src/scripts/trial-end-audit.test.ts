import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTrialEndAudit, parseTrialAuditArgs } from './trial-end-audit.js';

// [P61 · owner] Report only: the accounts whose stored trial end isn't the promised 14 days. Read-only by construction.
const DAY = 86_400_000;
function fakeDb(accounts: Array<Record<string, unknown>>, grants: Array<Record<string, unknown>>) {
  const seen: string[] = [];
  return { seen, query: async (sql: string) => { seen.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: /FROM subscriptions/.test(sql) ? accounts : /FROM trial_grants/.test(sql) ? grants : [] }; } };
}

describe('[P61] trial-end-audit', () => {
  it('lists an account that started after its inbox\'s trial ended, and a 7-day trial; leaves a 14-day one alone', async () => {
    const sept = Date.parse('2026-09-22T09:00:00Z');
    const db = fakeDb([
      { user_id: 'u1', email: 'wabil+test@prospera-technologies.com', status: 'trialing', created_at: new Date('2026-10-30T09:00:00Z'), trial_ends_at: new Date(sept + 14 * DAY) },
      { user_id: 'u2', email: 'old@x.io', status: 'trialing', created_at: new Date('2026-09-01T09:00:00Z'), trial_ends_at: new Date(Date.parse('2026-09-01T09:00:00Z') + 7 * DAY) },
      { user_id: 'u3', email: 'fine@x.io', status: 'trialing', created_at: new Date('2026-10-20T09:00:00Z'), trial_ends_at: new Date(Date.parse('2026-10-20T09:00:00Z') + 14 * DAY) },
    ], [
      { email: 'wabil@prospera-technologies.com', granted_at: new Date(sept) },
      { email: 'old@x.io', granted_at: new Date('2026-09-01T09:00:00Z') },
      { email: 'fine@x.io', granted_at: new Date('2026-10-20T09:00:00Z') },
    ]);
    const r = await runTrialEndAudit(db);
    expect(r.checked).toBe(3);
    expect(r.findings).toEqual([
      { userId: 'u1', email: 'wab…@prospera-technologies.com', createdAt: '2026-10-30', trialEndsAt: '2026-10-06', grantedAt: '2026-09-22', days: 14, verdict: 'ended_before_account' },
      { userId: 'u2', email: 'old…@x.io', createdAt: '2026-09-01', trialEndsAt: '2026-09-08', grantedAt: '2026-09-01', days: 7, verdict: 'short_trial' },
    ]);
  });
  it('NEGATIVE: read-only: one READ ONLY transaction, rolled back; --apply and any argument refused', async () => {
    const db = fakeDb([], []);
    await runTrialEndAudit(db);
    expect(db.seen[0]).toBe('BEGIN TRANSACTION READ');
    expect(db.seen.at(-1)).toBe('ROLLBACK');
    expect(() => parseTrialAuditArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseTrialAuditArgs(['--x'])).toThrow(/read-only/);
  });
  it('the ops runner knows it and treats it as read-only', () => {
    const sh = readFileSync(new URL('../../../../scripts/ops/run-backfill.sh', import.meta.url), 'utf8');
    expect(sh).toMatch(/trial-end-audit\) SCRIPT_IN_IMAGE="apps\/api\/src\/scripts\/trial-end-audit\.ts"/);
    expect(sh).toMatch(/\[ "\$SCRIPT_NAME" = "trial-end-audit" \]/);
  });
});
