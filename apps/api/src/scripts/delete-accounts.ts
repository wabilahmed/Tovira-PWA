/**
 * [P77 · owner] Delete every account that was granted access, except the addresses kept with --keep.
 *
 * Each account is deleted through the same path as Settings → Delete account (AccountService.deleteAccount): its
 * audio and image objects, then the account row, which cascades every table that belongs to it. No deletion email is
 * sent. Access requests and invites are not touched (Admin → Access keeps their history).
 *
 * Safety:
 *  - --keep is required, and every kept address must belong to an account, or nothing runs (a typo would otherwise
 *    delete everyone);
 *  - an account with a Stripe subscription that isn't canceled is SKIPPED and listed: cancel it in Stripe first;
 *  - the dry run (default) deletes nothing and prints the count; --apply needs --expect <that count>, so an account
 *    created between the two runs is never deleted unseen;
 *  - each account is deleted on its own: a failure is reported and the rest continue (run it again to retry).
 * Emails are printed redacted (first 3 characters + domain).
 *
 *   Dry run: scripts/ops/run-backfill.sh --script delete-accounts --keep bhavesh@mlbjewels.com
 *   Delete:  scripts/ops/run-backfill.sh --script delete-accounts --keep bhavesh@mlbjewels.com --apply --expect <n>
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { redactEmail } from './stripe-mode-audit.js';

interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export const ACCOUNTS_SQL = `
SELECT u.id, u.email, u.created_at, s.status, s.stripe_subscription_id,
       (SELECT count(*)::int FROM clients c WHERE c.user_id = u.id) AS clients,
       (SELECT count(*)::int FROM notes n WHERE n.user_id = u.id) AS notes
  FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
 ORDER BY u.created_at`;

export interface AccountRow { id: string; email: string; created_at: string; status: string | null; stripe_subscription_id: string | null; clients: number; notes: number }
export interface DeleteArgs { keep: string[]; apply: boolean; expect: number | null }
export interface DeleteResult { kept: AccountRow[]; targets: AccountRow[]; skipped: AccountRow[]; deleted: string[]; failed: Array<{ id: string; error: string }> }

export function parseDeleteArgs(argv: string[]): DeleteArgs {
  let keep: string[] | null = null;
  let apply = false;
  let expect: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') apply = true;
    else if (a === '--keep') keep = (argv[++i] ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    else if (a === '--expect') { const n = Number(argv[++i]); if (!Number.isInteger(n) || n < 0) throw new Error('--expect needs a whole number'); expect = n; }
    else throw new Error(`unknown argument: ${a} (expected --keep <email,…>, --apply, --expect <n>)`);
  }
  if (!keep || keep.length === 0) throw new Error('--keep <email,…> is required: the accounts that stay');
  if (apply && expect === null) throw new Error('--apply needs --expect <n>: the number of accounts the dry run listed');
  return { keep, apply, expect };
}

/** A Stripe subscription that may still bill: skipped, never deleted here. */
const paying = (a: AccountRow): boolean => !!a.stripe_subscription_id && a.status !== 'canceled';

export async function runDeleteAccounts(db: Queryable, deleteAccount: (userId: string) => Promise<void>, args: DeleteArgs): Promise<DeleteResult> {
  const rows = (await db.query(ACCOUNTS_SQL)).rows as unknown as AccountRow[];
  const keep = new Set(args.keep.map((e) => e.toLowerCase()));
  const isKept = (a: AccountRow): boolean => keep.has(a.email.trim().toLowerCase());
  for (const e of keep) if (!rows.some((a) => a.email.trim().toLowerCase() === e)) throw new Error(`no account for kept address ${redactEmail(e)}: nothing was deleted (check the spelling)`);
  const kept = rows.filter(isKept);
  const skipped = rows.filter((a) => !isKept(a) && paying(a));
  const targets = rows.filter((a) => !isKept(a) && !paying(a));
  const result: DeleteResult = { kept, targets, skipped, deleted: [], failed: [] };
  if (!args.apply) return result;
  if (args.expect !== targets.length) throw new Error(`expected ${args.expect} account(s) to delete, found ${targets.length}: nothing was deleted (run the dry run again)`);
  for (const a of targets) {
    try { await deleteAccount(a.id); result.deleted.push(a.id); }
    catch (e) { result.failed.push({ id: a.id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return result;
}

const line = (a: AccountRow): string => `${a.id} | ${redactEmail(a.email)} | created ${new Date(a.created_at).toISOString().slice(0, 10)} | plan ${a.status ?? 'none'}${a.stripe_subscription_id ? ' (Stripe)' : ''} | ${a.clients} client(s), ${a.notes} note(s)`;

async function main(): Promise<void> {
  const args = parseDeleteArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  // The deletion path, wired as the API wires it (index.ts), without the deletion email.
  const { loadConfig } = await import('../config.js');
  const c = await import('../container.js');
  const config = loadConfig();
  const appPool = createPool(config.appDatabaseUrl);
  const account = c.createAccountService(
    c.createAuthService(config, appPool), c.createClientRepository(config, appPool), c.createNoteRepository(config, appPool),
    c.createFactsRepository(config, appPool, pool), c.createMeetingRepository(config, appPool), c.createImageRepository(config, appPool),
    c.createRecallSessionRepository(config, appPool), undefined, c.createContactAliasRepository(config, appPool), c.createRepNameRepository(config, appPool),
    c.createExtractionLogRepository(config, appPool), c.createCorrectionRepository(config, appPool), c.createRepGlossaryRepository(config, appPool),
    c.createStorage(config), c.createClientPointerRepository(config, appPool), c.createInventoryRepository(config, appPool),
  );
  try {
    const r = await runDeleteAccounts(pool as unknown as Queryable, (id) => account.deleteAccount(id), args);
    const tag = '[delete-accounts]';
    console.log(`${tag} ${args.apply ? 'APPLY' : 'DRY RUN'}. Kept ${r.kept.length}:`);
    for (const a of r.kept) console.log(`${tag}   keep ${line(a)}`);
    console.log(`${tag} Skipped ${r.skipped.length} (a Stripe subscription that isn't canceled: cancel it in Stripe first):`);
    for (const a of r.skipped) console.log(`${tag}   skip ${line(a)}`);
    console.log(`${tag} ${args.apply ? 'Deleting' : 'Would delete'} ${r.targets.length}:`);
    for (const a of r.targets) console.log(`${tag}   ${args.apply ? (r.deleted.includes(a.id) ? 'deleted' : 'FAILED') : 'delete'} ${line(a)}`);
    for (const f of r.failed) console.log(`${tag}   error ${f.id}: ${f.error}`);
    if (!args.apply) console.log(`${tag} DRY RUN: nothing deleted. To delete: --apply --expect ${r.targets.length} (same --keep).`);
    else console.log(`${tag} deleted ${r.deleted.length}, failed ${r.failed.length}.`);
    if (r.failed.length > 0) process.exitCode = 2;
  } finally {
    await pool.end();
    await appPool.end();
  }
}

// Run only when executed directly, NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[delete-accounts] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
