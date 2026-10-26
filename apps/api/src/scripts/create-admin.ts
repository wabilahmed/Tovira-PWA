/**
 * [P45-1] Create the admin (console) account for an address listed in ADMIN_EMAILS, and email it the single-use
 * set-password link. Dry run by default (writes and sends nothing); `--apply` creates and sends. Refuses any address
 * not in ADMIN_EMAILS. An admin is NOT a rep: no client book, trial, billing or allowance.
 *   In prod:  scripts/ops/run-backfill.sh --script create-admin --email <address>            # dry run
 *             scripts/ops/run-backfill.sh --script create-admin --email <address> --apply    # create + email
 */
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PgAdminStore } from '../adapters/admin/pg-admin-store.js';
import { AdminAuthService } from '../services/admin/admin-auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { createEmailSender } from '../container.js';

export function parseCreateAdminArgs(argv: string[]): { email: string; apply: boolean } {
  let email = '';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--email') email = argv[++i] ?? '';
    else throw new Error(`unknown argument: ${argv[i]} (expected --email <address>, --apply)`);
  }
  if (!email.includes('@')) throw new Error('--email <address> is required');
  return { email, apply };
}

async function main(): Promise<void> {
  const { email, apply } = parseCreateAdminArgs(process.argv.slice(2));
  const config = loadConfig(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const svc = new AdminAuthService({ store: new PgAdminStore(pool), hasher: new ScryptHasher(), adminEmails: config.adminEmails, totpKey: config.adminTotpKey, appBaseUrl: config.appBaseUrl, email: createEmailSender(config) });
    const r = await svc.createAdmin(email, { apply });
    const say: Record<string, string> = {
      would_create: `DRY RUN: would create the admin account for ${r.email} and email the set-password link. Re-run with --apply.`,
      would_reinvite: `DRY RUN: ${r.email} exists without a password; would email a new set-password link. Re-run with --apply.`,
      created: `Created the admin account for ${r.email} and emailed the set-password link (valid 7 days, single use).`,
      reinvited: `Emailed a new set-password link to ${r.email}.`,
      already_set_up: `${r.email} is already set up (password set). Nothing to do.`,
    };
    console.log(`[create-admin] ${say[r.action]}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`[create-admin] ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
