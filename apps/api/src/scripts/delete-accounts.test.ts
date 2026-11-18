import { describe, it, expect, vi } from 'vitest';
import { parseDeleteArgs, runDeleteAccounts, type AccountRow } from './delete-accounts.js';

/**
 * [P77 · owner] Delete every account that was granted access except the ones the owner keeps (bhavesh@mlbjewels.com).
 * Dry run by default; --apply deletes through the same path as Settings → Delete account (data, audio, images, the
 * cascades), with no deletion email. Safety: --keep is required and every kept address must exist (a typo would
 * otherwise delete everyone); an account with a paid Stripe subscription is skipped (cancel it in Stripe first);
 * --apply needs --expect <n> equal to the dry run's count, so nothing new is deleted between the two.
 */
const row = (id: string, email: string, extra: Partial<AccountRow> = {}): AccountRow => ({ id, email, created_at: '2026-11-01T10:00:00.000Z', status: 'trialing', stripe_subscription_id: null, clients: 2, notes: 5, ...extra });
const ROWS = [
  row('u1', 'Bhavesh@MLBJewels.com'),
  row('u2', 'tester@example.com'),
  row('u3', 'someone@gmail.com', { status: 'active', stripe_subscription_id: null }), // free access granted, no Stripe
  row('u4', 'payer@company.com', { status: 'active', stripe_subscription_id: 'sub_123' }),
];
const db = (rows: AccountRow[]) => ({ query: vi.fn(async () => ({ rows: rows as unknown as Array<Record<string, unknown>> })) });

describe('[P77] delete-accounts arguments', () => {
  it('--keep is required; --apply needs --expect', () => {
    expect(() => parseDeleteArgs([])).toThrow(/--keep/);
    expect(() => parseDeleteArgs(['--keep', 'a@b.com', '--apply'])).toThrow(/--expect/);
    expect(parseDeleteArgs(['--keep', 'A@B.com, c@d.com', '--apply', '--expect', '3'])).toEqual({ keep: ['a@b.com', 'c@d.com'], apply: true, expect: 3 });
    expect(parseDeleteArgs(['--keep', 'a@b.com'])).toEqual({ keep: ['a@b.com'], apply: false, expect: null });
    expect(() => parseDeleteArgs(['--keep', 'a@b.com', '--what'])).toThrow(/unknown argument/);
  });
});

describe('[P77] delete-accounts', () => {
  it('dry run: lists every account but the kept one, skips the paying one, deletes nothing', async () => {
    const del = vi.fn(async (_id: string) => undefined);
    const r = await runDeleteAccounts(db(ROWS), del, { keep: ['bhavesh@mlbjewels.com'], apply: false, expect: null });
    expect(r.kept.map((a) => a.id)).toEqual(['u1']);
    expect(r.targets.map((a) => a.id)).toEqual(['u2', 'u3']);
    expect(r.skipped.map((a) => a.id)).toEqual(['u4']);
    expect(r.deleted).toEqual([]);
    expect(del).not.toHaveBeenCalled();
  });
  it('apply: deletes exactly the listed accounts through the account-deletion path', async () => {
    const del = vi.fn(async (_id: string) => undefined);
    const r = await runDeleteAccounts(db(ROWS), del, { keep: ['bhavesh@mlbjewels.com'], apply: true, expect: 2 });
    expect(del.mock.calls.map((c) => c[0])).toEqual(['u2', 'u3']);
    expect(r.deleted).toEqual(['u2', 'u3']);
    expect(r.failed).toEqual([]);
  });
  it('NEGATIVE: a kept address that does not exist refuses the whole run', async () => {
    const del = vi.fn(async (_id: string) => undefined);
    await expect(runDeleteAccounts(db(ROWS), del, { keep: ['bhavesh@mlbjewel.com'], apply: true, expect: 3 })).rejects.toThrow(/no account for kept address/);
    expect(del).not.toHaveBeenCalled();
  });
  it('NEGATIVE: --expect that does not match the count refuses the whole run', async () => {
    const del = vi.fn(async (_id: string) => undefined);
    await expect(runDeleteAccounts(db(ROWS), del, { keep: ['bhavesh@mlbjewels.com'], apply: true, expect: 3 })).rejects.toThrow(/expected 3.*2/);
    expect(del).not.toHaveBeenCalled();
  });
  it('NEGATIVE: the kept account is never deleted, whatever its case', async () => {
    const del = vi.fn(async (_id: string) => undefined);
    await runDeleteAccounts(db(ROWS), del, { keep: ['BHAVESH@mlbjewels.com'], apply: true, expect: 2 });
    expect(del.mock.calls.map((c) => c[0])).not.toContain('u1');
  });
  it('a failed deletion is reported and the rest still run (each account is retryable)', async () => {
    const del = vi.fn(async (id: string) => { if (id === 'u2') throw new Error('S3 down'); });
    const r = await runDeleteAccounts(db(ROWS), del, { keep: ['bhavesh@mlbjewels.com'], apply: true, expect: 2 });
    expect(r.deleted).toEqual(['u3']);
    expect(r.failed).toEqual([{ id: 'u2', error: 'S3 down' }]);
  });
});
