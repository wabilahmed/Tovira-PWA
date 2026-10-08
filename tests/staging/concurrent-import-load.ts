/**
 * [LOAD-TEST] Concurrent import load test against the DEPLOYED system. Synthetic zztest- data only.
 * Phases: `seed` (signup 5 + verify via DB + create clients — cheap, no model spend), then `fire`
 * (generate 20 exports, fire simultaneously via Promise.all, poll to ready — spends real credits).
 *
 * Distribution (lopsided, to expose starvation): A1=5 hard, A2=3 hard+1 medium, A3=2 hard+2 medium,
 * A4=2 medium+4 easy, A5=1 easy. Hard=5000 msgs, medium=500, easy=100.
 */
import { Pool } from 'pg';
import { writeFileSync, readFileSync } from 'node:fs';

const API = 'https://staging.tovira.io/api';
const STATE = '/tmp/zztest-load-state.json';
const RESULTS = '/tmp/zztest-load-results.json';
const pool = new Pool({ connectionString: process.env.PROD_DB_URL, ssl: { rejectUnauthorized: false } });

type Tier = 'hard' | 'medium' | 'easy';
const SIZES: Record<Tier, number> = { hard: 5000, medium: 500, easy: 100 };
const PLAN: Array<{ acct: number; tiers: Tier[] }> = [
  { acct: 1, tiers: ['hard', 'hard', 'hard', 'hard', 'hard'] },
  { acct: 2, tiers: ['hard', 'hard', 'hard', 'medium'] },
  { acct: 3, tiers: ['hard', 'hard', 'medium', 'medium'] },
  { acct: 4, tiers: ['medium', 'medium', 'easy', 'easy', 'easy', 'easy'] },
  { acct: 5, tiers: ['easy'] },
];

interface Acct { n: number; email: string; password: string; userId: string; cookie: string; }
interface ExportSpec { key: string; acct: number; tier: Tier; clientName: string; clientId?: string; collide?: 'crossAccount' | 'crossClientA' | 'crossClientB'; }
interface NoteDto { id: string; status: string; extractionState?: string; extracted?: { promises?: unknown[]; people?: unknown[]; key_dates?: unknown[]; next_steps?: unknown[] } }
interface ImportResp { imported?: number; held?: number; note?: { id?: string } }
interface TimingRow { key: string; acct: number; tier: Tier; clientId: string; status: number; imported: number | null; held: number; noteId: string | null; sendAt: number; respAt: number; uploadToReadyMs: number | null; doneAt: number | null; processingAt: number | null; findings: number | null; state: string }

// ---- helpers -------------------------------------------------------------
function sessionCookie(res: Response): string {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const raw = all.find((c) => c.startsWith('session=')) ?? res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}
async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ status: number; json: T; res: Response }> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as T, res };
}

// ---- synthetic export generation ----------------------------------------
const AR = ['تمام', 'ان شاء الله', 'اوكي حبيبي', 'شكرا', 'ماشي', 'تسلم']; // common code-switch fillers
const ARABIZI = ['tamam', 'inshallah', 'yalla', 'akeed', '3ala baraket allah', 'mashi'];
// sensitive-adjacent FLAG seeds (benign in context — the point is they trip the recall-tuned detector)
const FLAGS = ['my back is sore again', 'see you after the party on Friday', 'the Filipino agent will handle keys',
  'he is still in treatment', "meet at the tennis court", 'the villa near the church', 'his back went out moving boxes',
  'their party runs the district', 'court date got pushed', 'the Indian visa paperwork is slow'];
const AMBIG_DATES = ['let’s aim for the 3rd', 'sometime next month', 'after Eid', 'by the 15th', 'early spring'];

function genExport(spec: ExportSpec, rep: string): string {
  const n = SIZES[spec.tier];
  const lines: string[] = [];
  const seedFlags = spec.tier !== 'easy'; // easy stays clean (control)
  // ~2-4% of a hard/medium chat carries a flag term; concentrate a few dominant tokens.
  for (let i = 0; i < n; i++) {
    const day = String((i % 27) + 1).padStart(2, '0');
    const mo = String(((Math.floor(i / 27)) % 12) + 1).padStart(2, '0');
    const hh = String(i % 24).padStart(2, '0');
    const mm = String(i % 60).padStart(2, '0');
    const from = i % 2 === 0 ? spec.clientName : rep;
    let body: string;
    if (seedFlags && i % 40 === 0) body = FLAGS[(i / 40) % FLAGS.length]!; // dominant flag tokens, repeated
    else if (seedFlags && i % 97 === 0) body = FLAGS[i % FLAGS.length]!; // a scatter of others
    else if (spec.tier === 'hard' && i % 7 === 0) body = `${AR[i % AR.length]} — ${AMBIG_DATES[i % AMBIG_DATES.length]}`;
    else if (spec.tier === 'hard' && i % 11 === 0) body = `${ARABIZI[i % ARABIZI.length]}, the unit at 2.${i % 9}m`;
    else if (spec.tier === 'hard' && i % 13 === 0) body = `btw people call ${spec.clientName} "Boss ${spec.acct}" sometimes`; // alias mention
    else body = `msg ${i}: following up on the ${['2BR', 'villa', 'plot', 'penthouse'][i % 4]}, ready to move`;
    // colliding counterparty content (leakage probes) — same NAME, DIFFERENT facts
    if (i === 5 && spec.collide === 'crossAccount') body = 'Zelda Quorn holds 4m in escrow, ready to proceed';
    if (i === 5 && spec.collide === 'crossClientA') body = 'Zelda Quorn wants a sea view only, budget 6m';
    if (i === 5 && spec.collide === 'crossClientB') body = 'Zelda Quorn prefers morning viewings, cash buyer';
    lines.push(`[2026-${mo}-${day}, ${hh}:${mm}:00] ${from}: ${body}`);
  }
  return lines.join('\n');
}

// ---- phases --------------------------------------------------------------
async function seed(): Promise<void> {
  const accts: Acct[] = [];
  for (let n = 1; n <= 5; n++) {
    const email = `zztest-load-${n}-${Date.now()}@example.com`;
    const password = `Zz!load-${n}-${Math.random().toString(36).slice(2, 10)}`;
    const s = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: { email, password, consent: true, timezone: 'Asia/Dubai' } });
    if (s.status !== 201) throw new Error(`signup ${n} failed: ${s.status} ${JSON.stringify(s.json)}`);
    const userId = s.json.user.id as string;
    const cookie = sessionCookie(s.res);
    if (!cookie) throw new Error(`signup ${n}: no session cookie`);
    // verify (no inbox) — transaction + rowcount assertion, WHERE by the zztest id
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`UPDATE users SET email_verified = true WHERE id = $1 AND email LIKE 'zztest-%'`, [userId]);
      if (r.rowCount !== 1) { await c.query('ROLLBACK'); throw new Error(`verify ${n}: expected 1 row, got ${r.rowCount}`); }
      await c.query('COMMIT');
    } finally { c.release(); }
    accts.push({ n, email, password, userId, cookie });
    console.log(`seeded acct ${n}: ${email} id=${userId} verified`);
  }
  // clients + export specs
  const exports: ExportSpec[] = [];
  for (const p of PLAN) {
    const acct = accts.find((a) => a.n === p.acct)!;
    for (let i = 0; i < p.tiers.length; i++) {
      const clientName = `zztest Client ${p.acct}-${i + 1}`;
      const cr = await api<{ id: string }>('/clients', { method: 'POST', body: { name: clientName }, cookie: acct.cookie });
      if (cr.status !== 201) throw new Error(`client ${p.acct}-${i} failed: ${cr.status} ${JSON.stringify(cr.json)}`);
      let collide: ExportSpec['collide'];
      if (p.acct === 1 && i === 0) collide = 'crossAccount';
      if (p.acct === 2 && i === 0) collide = 'crossAccount';
      if (p.acct === 3 && i === 0) collide = 'crossClientA';
      if (p.acct === 3 && i === 1) collide = 'crossClientB';
      exports.push({ key: `${p.acct}-${i + 1}`, acct: p.acct, tier: p.tiers[i]!, clientName, clientId: cr.json.id as string, collide });
    }
  }
  writeFileSync(STATE, JSON.stringify({ accts, exports }, null, 2));
  console.log(`\nSEED done: ${accts.length} accounts, ${exports.length} clients/exports. State -> ${STATE}`);
  console.log('tiers:', exports.map((e) => `${e.key}:${e.tier}${e.collide ? '(' + e.collide + ')' : ''}`).join(' '));
}

async function fire(): Promise<void> {
  const { accts, exports } = JSON.parse(readFileSync(STATE, 'utf8')) as { accts: Acct[]; exports: ExportSpec[] };
  const repOf = (acct: number) => `Agent ${acct}`;
  // Pre-build every payload BEFORE firing, so the network sends are near-simultaneous.
  const reqs = exports.map((e) => {
    const acct = accts.find((a) => a.n === e.acct)!;
    const content = genExport(e, repOf(e.acct));
    return { e, acct, content };
  });
  console.log(`built ${reqs.length} payloads; firing simultaneously…`);
  const t0 = Date.now();
  const fired = await Promise.all(reqs.map(async ({ e, acct, content }) => {
    const sendAt = Date.now();
    let r = await api<ImportResp>(`/clients/${e.clientId}/notes/import`, { method: 'POST', cookie: acct.cookie, body: { content, consent: true, firstImportAck: true } });
    // handle a first-import 409 (counterpart confirm) by re-sending with the ack
    if (r.status === 409) {
      r = await api<ImportResp>(`/clients/${e.clientId}/notes/import`, { method: 'POST', cookie: acct.cookie, body: { content, consent: true, firstImportAck: true, confirmImport: true, misfileAck: true, counterpart: e.clientName } });
    }
    const respAt = Date.now();
    return { key: e.key, acct: e.acct, tier: e.tier, clientId: e.clientId!, status: r.status, imported: r.json?.imported ?? null, held: r.json?.held ?? 0, noteId: r.json?.note?.id ?? null, sendAt, respAt };
  }));
  const spread = Math.max(...fired.map((f) => f.sendAt)) - Math.min(...fired.map((f) => f.sendAt));
  console.log(`fired ${fired.length}; send spread=${spread}ms; statuses=${fired.map((f) => f.status).join(',')}`);

  // Poll each note to ready (extracted) or failed. Record transition timestamps.
  const timings: Record<string, TimingRow> = {};
  for (const f of fired) timings[f.key] = { ...f, uploadToReadyMs: null, doneAt: null, processingAt: null, findings: null, state: 'pending' };
  const deadline = t0 + 20 * 60 * 1000; // 20 min hard cap
  while (Date.now() < deadline) {
    let allSettled = true;
    for (const acct of accts) {
      const clientsForAcct = fired.filter((f) => f.acct === acct.n);
      for (const f of clientsForAcct) {
        const t = timings[f.key]!;
        if (t.state === 'extracted' || t.state === 'failed') continue;
        allSettled = false;
        const nr = await api<{ notes?: NoteDto[] }>(`/clients/${f.clientId}/notes`, { cookie: acct.cookie });
        const note = (nr.json?.notes ?? []).find((x) => x.id === f.noteId) ?? (nr.json?.notes ?? [])[0];
        if (!note) continue;
        const es = note.extractionState ?? note.status;
        if (es === 'processing' && !t.processingAt) t.processingAt = Date.now();
        if (note.status === 'extracted' || es === 'done') {
          t.state = 'extracted'; t.doneAt = Date.now(); t.uploadToReadyMs = t.doneAt - f.sendAt;
          const ex = note.extracted;
          t.findings = (ex?.promises?.length ?? 0) + (ex?.people?.length ?? 0) + (ex?.key_dates?.length ?? 0) + (ex?.next_steps?.length ?? 0);
        } else if (note.status === 'needs_review' || es === 'failed' || note.status === 'import_failed') {
          t.state = 'failed'; t.doneAt = Date.now(); t.uploadToReadyMs = t.doneAt - f.sendAt;
        }
      }
    }
    if (allSettled) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  writeFileSync(RESULTS, JSON.stringify({ t0, timings }, null, 2));
  // print per-import, by tier
  console.log('\n=== per-import (upload -> ready) ===');
  for (const key of Object.keys(timings)) {
    const t = timings[key]!;
    console.log(`${key} ${t.tier}\tstatus=${t.status} state=${t.state} ready=${t.uploadToReadyMs != null ? (t.uploadToReadyMs / 1000).toFixed(1) + 's' : 'NOT READY'} findings=${t.findings ?? '-'} held=${t.held}`);
  }
}

async function cleanup(): Promise<void> {
  const { accts } = JSON.parse(readFileSync(STATE, 'utf8')) as { accts: Acct[] };
  for (const a of accts) {
    let cookie = a.cookie;
    let del = await api('/account', { method: 'DELETE', cookie });
    if (del.status === 401) { // cookie expired — re-login then delete
      const lg = await api('/auth/login', { method: 'POST', body: { email: a.email, password: a.password } });
      cookie = sessionCookie(lg.res);
      del = await api('/account', { method: 'DELETE', cookie });
    }
    const relogin = await api('/auth/login', { method: 'POST', body: { email: a.email, password: a.password } });
    console.log(`A${a.n}: delete=${del.status} relogin=${relogin.status} (expect 401)`);
  }
  // Straggler sweep: model_call_events has no RLS/user cascade — clean by zztest user_id in a txn.
  const ids = accts.map((a) => a.userId);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query('DELETE FROM model_call_events WHERE user_id = ANY($1::text[])', [ids]);
    console.log(`deleted ${r.rowCount} straggler model_call_events rows`);
    await c.query('COMMIT');
  } finally { c.release(); }
  // Final proof on the NO-RLS tables (definitive as tovira_app): users + model_call_events.
  const u = await pool.query(`select count(*)::int c from users where email like 'zztest-%'`);
  const m = await pool.query(`select count(*)::int c from model_call_events where user_id = ANY($1::text[])`, [ids]);
  console.log(`  users zztest -> ${u.rows[0].c}`);
  console.log(`  model_call_events zztest -> ${m.rows[0].c}`);
  // Spot-check an RLS table (notes) per deleted user via SET — 0 confirms the purge, not just RLS.
  for (const a of accts) {
    const c2 = await pool.connect();
    try {
      await c2.query(`SET app.user_id = '${a.userId}'`);
      const r = await c2.query('select count(*)::int c from notes');
      console.log(`  A${a.n} notes (scoped) -> ${r.rows[0].c}`);
    } finally { c2.release(); }
  }
}

const phase = process.argv[2];
(async () => {
  if (phase === 'seed') await seed();
  else if (phase === 'fire') await fire();
  else if (phase === 'cleanup') await cleanup();
  else throw new Error('usage: tsx concurrent-import-load.ts seed|fire|cleanup');
  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
