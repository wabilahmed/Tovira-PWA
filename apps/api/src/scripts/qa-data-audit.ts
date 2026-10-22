/**
 * [P39-10] READ-ONLY list of QA / test data in prod, for the owner to decide on — and the dry-run of what a
 * delete WOULD remove. Nothing is deleted here (there is no --apply; it is refused). It prints, each with id,
 * name, created date and why it was flagged:
 *   - clients whose name is an HTML/script probe ("<img src=x onerror=alert(1)>");
 *   - clients named "QA …";
 *   - clients that look bulk-imported in a test batch (≥ 3 clients made within 60 seconds by one account, each
 *     with a WhatsApp-export note) — a heuristic: the schema keeps no "imported in batch X" marker;
 *   - access requests that look like QA (a "QA"/"test" name, or an example/tovira address);
 *   - sold-out inventory items (status disabled, reason sold_out);
 *   - and, separately, requirement summaries that contradict themselves ("1BR villa", "2BR studio") — reported
 *     only, the data is never changed.
 * Then the DRY-RUN DELETE: the exact statements a delete would run, by id. Accounts are never touched (the test
 * rep's account stays). Emails are redacted (first 3 characters + domain).
 * [P40-5] Deleting: only the ids you pass, in one transaction; refused whole if any id is unknown or is an access
 * request that is activated or has a user account.
 *   List:     scripts/ops/run-backfill.sh --script qa-data-audit
 *   Dry run:  scripts/ops/run-backfill.sh --script qa-data-audit --ids <id,id,…>
 *   Delete:   scripts/ops/run-backfill.sh --script qa-data-audit --ids <id,id,…> --apply
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { redactEmail } from './stripe-mode-audit.js';
import { requirementFacets } from '../services/clients/requirement-summary.js';

interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

export const CLIENTS_SQL = `
SELECT c.id, c.user_id, u.email, c.name, c.created_at,
       EXISTS (SELECT 1 FROM notes n WHERE n.client_id = c.id AND n.source = 'whatsapp_export') AS has_export
  FROM clients c JOIN users u ON u.id = c.user_id
 ORDER BY c.user_id, c.created_at`;
export const ACCESS_SQL = `SELECT id, full_name, work_email, company_name, status, created_at FROM access_requests ORDER BY created_at`;
export const SOLD_OUT_SQL = `
SELECT i.id, i.user_id, u.email, i.title, i.quantity, i.created_at
  FROM inventory_items i JOIN users u ON u.id = i.user_id
 WHERE i.status = 'disabled' AND i.disabled_reason = 'sold_out'
 ORDER BY i.created_at`;
export const REQUIREMENTS_SQL = `
SELECT r.client_id, c.name, r.text, r.requirement_raw, r.stated_on, r.created_at
  FROM requirements r JOIN clients c ON c.id = r.client_id
 WHERE r.status = 'open'
 ORDER BY r.client_id, r.created_at`;

export interface Flag { kind: 'client' | 'access_request' | 'inventory_item'; id: string; name: string; createdAt: string; account: string; why: string }

const PROBE = /<[^>]*>|onerror|javascript:|<script/i;
const QA_NAME = /^\s*QA\b/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** [P40-5] No args → the read-only list. `--ids a,b` → a dry run of deleting exactly those. `--apply --ids a,b` →
 *  delete exactly those (one transaction). `--apply` without `--ids` is refused. */
export function parseQaAuditArgs(argv: string[]): { apply: boolean; ids: string[] | null } {
  let apply = false;
  let ids: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') apply = true;
    else if (a === '--ids') {
      const v = argv[++i];
      if (!v) throw new Error('--ids needs a comma-separated list of ids');
      ids = v.split(',').map((x) => x.trim()).filter(Boolean);
      const bad = ids.filter((x) => !UUID.test(x));
      if (bad.length) throw new Error(`--ids expects uuids, got: ${bad.join(', ')}`);
    } else throw new Error(`unknown argument: ${a} (expected --ids <id,id,…> and optionally --apply)`);
  }
  if (apply && (!ids || ids.length === 0)) throw new Error('--apply deletes only the ids you pass: add --ids <id,id,…>');
  return { apply, ids };
}

/** [P40-5] What each id is, read before anything is deleted. */
export const QA_DELETE_LOOKUP_SQL = {
  clients: 'SELECT id, name FROM clients WHERE id = ANY($1::uuid[])',
  access: `SELECT ar.id, ar.full_name, ar.status,
       (EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(ar.work_email))
        OR EXISTS (SELECT 1 FROM invites i WHERE i.access_request_id = ar.id)) AS has_user
  FROM access_requests ar WHERE ar.id = ANY($1::uuid[])`,
  inventory: 'SELECT id, title FROM inventory_items WHERE id = ANY($1::uuid[])',
};

/** [P40-5] Delete exactly `ids` — or, with apply=false, say what would go. Refuses the WHOLE run (nothing deleted)
 *  if any id is unknown, or is an access request that is activated or whose user account exists. Accounts are
 *  never deleted here. */
export async function runQaDelete(db: Queryable, ids: string[], apply: boolean): Promise<{ wouldDelete: string[]; refused: string[]; deleted: number }> {
  await db.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const clients = (await db.query(QA_DELETE_LOOKUP_SQL.clients, [ids] as never)).rows as Array<{ id: string; name: string }>;
    const access = (await db.query(QA_DELETE_LOOKUP_SQL.access, [ids] as never)).rows as Array<{ id: string; full_name: string; status: string; has_user: boolean }>;
    const inventory = (await db.query(QA_DELETE_LOOKUP_SQL.inventory, [ids] as never)).rows as Array<{ id: string; title: string }>;
    const known = new Set([...clients, ...access, ...inventory].map((r) => r.id));
    const refused = [
      ...ids.filter((id) => !known.has(id)).map((id) => `${id}: not a client, access request or inventory item`),
      ...access.filter((a) => a.status === 'activated').map((a) => `access request ${a.id} "${a.full_name}" is activated`),
      ...access.filter((a) => a.status !== 'activated' && a.has_user).map((a) => `access request ${a.id} "${a.full_name}" has a user account`),
    ];
    const wouldDelete = [
      ...clients.map((c) => `client ${c.id} "${c.name}"`),
      ...access.map((a) => `access request ${a.id} "${a.full_name}"`),
      ...inventory.map((i) => `inventory item ${i.id} "${i.title}"`),
    ];
    if (!apply || refused.length > 0) {
      await db.query('ROLLBACK');
      return { wouldDelete, refused, deleted: 0 };
    }
    let deleted = 0;
    const del = async (sql: string, list: Array<{ id: string }>) => {
      if (list.length === 0) return;
      const res = (await db.query(sql, [list.map((r) => r.id)] as never)) as unknown as { rowCount?: number };
      deleted += res.rowCount ?? 0;
    };
    await del('DELETE FROM clients WHERE id = ANY($1::uuid[])', clients);
    await del('DELETE FROM access_requests WHERE id = ANY($1::uuid[])', access);
    await del('DELETE FROM inventory_items WHERE id = ANY($1::uuid[])', inventory);
    await db.query('COMMIT');
    return { wouldDelete, refused, deleted };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

/** Clients: an HTML/script probe, a "QA …" name, or a member of a test-looking bulk batch. */
export function flagClients(rows: Array<{ id: string; user_id: string; email: string; name: string; created_at: unknown; has_export: boolean }>): Flag[] {
  const out: Flag[] = [];
  const seen = new Set<string>();
  const push = (r: (typeof rows)[number], why: string) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ kind: 'client', id: r.id, name: r.name, createdAt: iso(r.created_at), account: redactEmail(r.email), why });
  };
  for (const r of rows) {
    if (PROBE.test(r.name)) push(r, 'name is an HTML/script probe (security test)');
    else if (QA_NAME.test(r.name)) push(r, 'name starts with "QA"');
  }
  // Bulk batches: ≥ 3 clients by one account within 60 s, each with a WhatsApp-export note.
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const list of byUser.values()) {
    const sorted = list.filter((r) => r.has_export).sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && Date.parse(String(sorted[j + 1]!.created_at)) - Date.parse(String(sorted[i]!.created_at)) <= 60_000) j++;
      const n = j - i + 1;
      if (n >= 3) for (const r of sorted.slice(i, j + 1)) push(r, `bulk-imported: one of ${n} clients created within 60 seconds from chat exports`);
      i = j + 1;
    }
  }
  return out;
}

/** Access requests that look like QA: a QA/test name, or an example/test/tovira address. */
export function flagAccessRequests(rows: Array<{ id: string; full_name: string; work_email: string; company_name: string; status: string; created_at: unknown }>): Flag[] {
  return rows
    .filter((r) => /\bqa\b|\btest/i.test(`${r.full_name} ${r.company_name}`) || /@(example\.(com|org|net)|test\.|tovira\.io$)|\+qa|\bqa[.-]?\w*@/i.test(r.work_email))
    .map((r) => ({ kind: 'access_request' as const, id: r.id, name: r.full_name, createdAt: iso(r.created_at), account: redactEmail(r.work_email), why: `looks like a QA request (status ${r.status})` }));
}

/** Requirement summaries that contradict themselves: a 0–1BR villa / townhouse / penthouse, or a studio with bedrooms. */
export function contradictions(rows: Array<{ client_id: string; name: string; text: string; requirement_raw: string; stated_on: unknown; created_at: unknown }>): Array<{ clientId: string; name: string; says: string; requirements: string[] }> {
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.client_id, [...(by.get(r.client_id) ?? []), r]);
  const out: Array<{ clientId: string; name: string; says: string; requirements: string[] }> = [];
  // [P40-5] read ONE requirement at a time — a "1BR" from one and a "Villa" from another is not a contradiction
  for (const [clientId, reqs] of by) {
    for (const r of reqs) {
      const f = requirementFacets([{ text: r.text, requirementRaw: r.requirement_raw, statedOn: r.stated_on ? iso(r.stated_on) : null, createdAt: Date.parse(String(r.created_at)) || 0 }]);
      const beds = f.beds ? Number(f.beds.replace('BR', '')) : null;
      const big = f.type === 'Villa' || f.type === 'Townhouse' || f.type === 'Penthouse';
      if (beds !== null && ((big && beds <= 1) || (f.type === 'Studio' && beds >= 1))) {
        out.push({ clientId, name: r.name, says: `${f.beds} ${f.type}`, requirements: [r.requirement_raw || r.text] });
      }
    }
  }
  return out;
}

/** The statements a delete would run, by id — printed only, never executed here. */
export function dryRunDelete(flags: Flag[]): string[] {
  const ids = (k: Flag['kind']) => flags.filter((f) => f.kind === k).map((f) => `'${f.id}'`);
  const out: string[] = [];
  if (ids('client').length) out.push(`DELETE FROM clients WHERE id IN (${ids('client').join(', ')}); -- notes, facts, requirements and shares go with them (ON DELETE CASCADE)`);
  if (ids('access_request').length) out.push(`DELETE FROM access_requests WHERE id IN (${ids('access_request').join(', ')}); -- their invites go with them`);
  if (ids('inventory_item').length) out.push(`DELETE FROM inventory_items WHERE id IN (${ids('inventory_item').join(', ')}); -- its shares go with it`);
  return out;
}

export async function runQaAudit(db: Queryable): Promise<{ flags: Flag[]; contradictions: ReturnType<typeof contradictions>; statements: string[] }> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    const clients = (await db.query(CLIENTS_SQL)).rows as Parameters<typeof flagClients>[0];
    const access = (await db.query(ACCESS_SQL)).rows as Parameters<typeof flagAccessRequests>[0];
    const sold = (await db.query(SOLD_OUT_SQL)).rows as Array<{ id: string; email: string; title: string; quantity: number; created_at: unknown }>;
    const reqs = (await db.query(REQUIREMENTS_SQL)).rows as Parameters<typeof contradictions>[0];
    const flags = [
      ...flagClients(clients),
      ...flagAccessRequests(access),
      ...sold.map((r) => ({ kind: 'inventory_item' as const, id: r.id, name: r.title, createdAt: iso(r.created_at), account: redactEmail(r.email), why: `sold out (quantity ${r.quantity})` })),
    ];
    return { flags, contradictions: contradictions(reqs), statements: dryRunDelete(flags) };
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main(): Promise<void> {
  const args = parseQaAuditArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    if (args.ids) {
      const r = await runQaDelete(client as unknown as Queryable, args.ids, args.apply);
      console.log(`[qa-data-audit] ${args.apply ? 'APPLY' : 'DRY RUN'} for ${args.ids.length} id(s):`);
      for (const w of r.wouldDelete) console.log(`[qa-data-audit]   ${args.apply && r.refused.length === 0 ? 'deleting' : 'would delete'} ${w}`);
      for (const x of r.refused) console.log(`[qa-data-audit]   REFUSED ${x}`);
      if (r.refused.length > 0) { console.log('[qa-data-audit] refused — nothing was deleted.'); process.exitCode = 2; return; }
      console.log(args.apply ? `[qa-data-audit] deleted ${r.deleted} row(s) (their notes, facts, invites and shares go with them).` : '[qa-data-audit] DRY RUN — nothing deleted. Re-run with --apply and the same --ids to delete.');
      return;
    }
    const r = await runQaAudit(client as unknown as Queryable);
    console.log(`[qa-data-audit] READ-ONLY. ${r.flags.length} item(s) flagged.`);
    for (const f of r.flags) console.log(`[qa-data-audit] ${f.kind} ${f.id} | ${JSON.stringify(f.name)} | created ${f.createdAt} | account ${f.account} | ${f.why}`);
    console.log(`[qa-data-audit] ${r.contradictions.length} contradictory requirement summary(ies) (reported only):`);
    for (const c of r.contradictions) console.log(`[qa-data-audit] requirement ${c.clientId} | ${JSON.stringify(c.name)} | says "${c.says}" | from: ${c.requirements.map((x) => JSON.stringify(x)).join(' ; ')}`);
    console.log('[qa-data-audit] DRY-RUN DELETE (not executed):');
    for (const s of r.statements) console.log(`[qa-data-audit]   ${s}`);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run only when executed directly — NOT when imported by a test (which would try to open a pool).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[qa-data-audit] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
