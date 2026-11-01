/**
 * [P63-1 · owner] READ-ONLY: where invited leads and public requests stop, over the last 14 days. It changes nothing.
 *  1. Per invited lead (email partly hidden): invite sent, form submitted, approved, password set, first sign-in, first
 *     client. "Invite link opened" is not recorded anywhere yet (the Funnel work records it from its deploy on).
 *  2. Requests: how many came in (public form vs invite) and where each stands; approved people whose set-password link
 *     expired unused; pending requests waiting for the admin. Failed submissions (4xx/5xx) were never recorded: the API
 *     does not log request outcomes and the load balancer's access logs are off.
 *  3. Resend: delivered / bounced / marked-spam counts for our sends (the Resend API, read-only). Opens are never read.
 * One READ ONLY transaction (rolled back). Takes no arguments and refuses --apply.
 *   Local:   DATABASE_URL=… [RESEND_API_KEY=…] npx tsx apps/api/src/scripts/funnel-diagnose.ts
 *   In prod: scripts/ops/run-backfill.sh --script funnel-diagnose
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { redactEmail } from './stripe-mode-audit.js';

export const WINDOW_DAYS = 14;

export const INVITED_LEADS_SQL = `
SELECT h.id, h.email, h.is_test, h.status AS lead_status, h.invite_sent_at, h.invite_resent_at, h.requested_at,
       a.status AS request_status, a.reviewed_at, a.linked_user_id,
       (SELECT min(i.consumed_at) FROM invites i WHERE i.access_request_id = a.id) AS password_set_at,
       (SELECT min(s.created_at) FROM sessions s WHERE s.user_id = a.linked_user_id) AS first_session_at,
       (SELECT min(n.created_at) FROM notes n WHERE n.user_id = a.linked_user_id) AS first_note_at
  FROM hot_leads h
  LEFT JOIN access_requests a ON a.id = h.access_request_id
 WHERE h.invite_sent_at >= now() - interval '${WINDOW_DAYS} days'
    OR (a.id IS NOT NULL AND a.created_at >= now() - interval '${WINDOW_DAYS} days')
 ORDER BY coalesce(h.invite_sent_at, a.created_at)`;
export const LEAD_TOTALS_SQL = `SELECT status, count(*)::int AS n FROM hot_leads WHERE NOT is_test GROUP BY status ORDER BY status`;
export const REQUESTS_SQL = `
SELECT a.id, a.work_email, a.source, a.status, a.created_at, a.reviewed_at,
       EXISTS (SELECT 1 FROM hot_leads h WHERE h.access_request_id = a.id AND h.requested_at IS NOT NULL) AS from_invite_email,
       (SELECT max(i.expires_at) FROM invites i WHERE i.access_request_id = a.id) AS link_expires_at,
       (SELECT bool_or(i.consumed_at IS NOT NULL) FROM invites i WHERE i.access_request_id = a.id) AS link_used
  FROM access_requests a
 WHERE a.created_at >= now() - interval '${WINDOW_DAYS} days'
 ORDER BY a.created_at`;

interface Queryable { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }
const day = (v: unknown): string => (v ? new Date(v as string | Date).toISOString().slice(0, 16).replace('T', ' ') : '-');

export function parseFunnelArgs(argv: string[]): Record<string, never> {
  for (const a of argv) {
    if (a === '--apply') throw new Error('funnel-diagnose is read-only — it has nothing to apply');
    throw new Error(`unknown argument: ${a} (funnel-diagnose takes none; it is read-only)`);
  }
  return {};
}

export interface DeliveryCounts { delivered: number; bounced: number; complained: number; other: number; checked: number; note: string | null }
type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Resend's last event per email in the window: delivered, bounced, complained (marked spam). An opened or clicked email
 *  was delivered, and is counted only as delivered (opens are never reported). */
export async function resendDelivery(fetchFn: FetchFn, apiKey: string | undefined, sinceMs: number): Promise<DeliveryCounts> {
  const out: DeliveryCounts = { delivered: 0, bounced: 0, complained: 0, other: 0, checked: 0, note: null };
  if (!apiKey) return { ...out, note: 'RESEND_API_KEY not set: delivery not checked' };
  const res = await fetchFn('https://api.resend.com/emails?limit=100', { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { ...out, note: `Resend list emails answered ${res.status}: delivery not checked` };
  const body = (await res.json()) as { data?: Array<{ created_at?: string; last_event?: string }> };
  for (const e of body.data ?? []) {
    if (!e.created_at || Date.parse(e.created_at) < sinceMs) continue;
    out.checked++;
    const ev = (e.last_event ?? '').toLowerCase();
    if (ev === 'delivered' || ev === 'opened' || ev === 'clicked') out.delivered++;
    else if (ev === 'bounced') out.bounced++;
    else if (ev === 'complained') out.complained++;
    else out.other++;
  }
  return out;
}

export async function runFunnelDiagnose(db: Queryable, nowMs: number): Promise<string[]> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  let leads: Array<Record<string, unknown>>; let totals: Array<Record<string, unknown>>; let requests: Array<Record<string, unknown>>;
  try {
    leads = (await db.query(INVITED_LEADS_SQL)).rows;
    totals = (await db.query(LEAD_TOTALS_SQL)).rows;
    requests = (await db.query(REQUESTS_SQL)).rows;
  } finally {
    await db.query('ROLLBACK');
  }
  const out: string[] = [];
  out.push(`[funnel] READ-ONLY. Last ${WINDOW_DAYS} days.`);
  out.push(`[funnel] hot leads by status (all time, tests excluded): ${totals.map((t) => `${t.status} ${t.n}`).join(', ') || 'none'}`);
  out.push(`[funnel] 1. invited leads: ${leads.length}`);
  for (const l of leads) {
    out.push(`[funnel]    ${redactEmail(String(l.email ?? ''))}${l.is_test ? ' (test)' : ''}  lead ${l.lead_status}  invite sent ${day(l.invite_sent_at)}${l.invite_resent_at ? ` (re-sent ${day(l.invite_resent_at)})` : ''}  link opened: not recorded  form ${day(l.requested_at)}  request ${l.request_status ?? '-'} ${day(l.reviewed_at)}  password ${day(l.password_set_at)}  first sign-in ${day(l.first_session_at)}  first client ${day(l.first_note_at)}`);
  }
  const by = (f: (r: Record<string, unknown>) => boolean) => requests.filter(f).length;
  out.push(`[funnel] 2. requests: ${requests.length} (public form ${by((r) => !r.from_invite_email && r.source === 'form')}, from an invite email ${by((r) => r.from_invite_email === true)}, made from a lead by the admin ${by((r) => r.source === 'hot_lead')})`);
  out.push(`[funnel]    pending (waiting for you): ${by((r) => r.status === 'pending')}; approved, link not used yet: ${by((r) => r.status === 'invited' && !r.link_used)}; activated: ${by((r) => r.status === 'activated')}; rejected: ${by((r) => r.status === 'rejected')}`);
  for (const r of requests.filter((x) => x.status === 'pending')) out.push(`[funnel]    pending since ${day(r.created_at)}: ${redactEmail(String(r.work_email))} (${r.source})`);
  for (const r of requests.filter((x) => x.status === 'invited' && !x.link_used && x.link_expires_at && new Date(x.link_expires_at as string | Date).getTime() <= nowMs)) {
    out.push(`[funnel]    approved but the set-password link EXPIRED unused (${day(r.link_expires_at)}): ${redactEmail(String(r.work_email))}`);
  }
  out.push('[funnel]    failed submissions (4xx/5xx): not recorded (the API logs no request outcomes; the load balancer\'s access logs are off)');
  return out;
}

async function main(): Promise<void> {
  parseFunnelArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  try {
    const now = Date.now();
    for (const line of await runFunnelDiagnose(pool, now)) console.log(line);
    const d = await resendDelivery(fetch as unknown as FetchFn, process.env.RESEND_API_KEY, now - WINDOW_DAYS * 86_400_000);
    console.log(d.note ? `[funnel] 3. Resend: ${d.note}` : `[funnel] 3. Resend (last ${WINDOW_DAYS} days, up to the latest 100 sends): ${d.checked} sent; delivered ${d.delivered}, bounced ${d.bounced}, marked spam ${d.complained}, other ${d.other}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => { console.error(`[funnel] ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
}
