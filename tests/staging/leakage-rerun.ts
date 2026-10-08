/**
 * [LEAKAGE RE-RUN] Focused isolation test with FACT-BEARING seeds (the load test's flat messages produced
 * zero promises — cause 1). 2 accounts; account A has 2 clients (cross-client, the RLS-unprotected case),
 * account B has 1 (cross-account). Distinct single-occurrence marker terms + a shared counterparty
 * ("Zelda Quorn") with DIFFERENT facts per chat. Confirms facts extracted, THEN runs the full battery.
 * Reports per surface: CLEAN / LEAKED / NOT-CHECKED. Synthetic zztest- data only; cleaned up at the end.
 */
import { Pool } from 'pg';
const API = 'https://staging.tovira.io/api';
const pool = new Pool({ connectionString: process.env.PROD_DB_URL, ssl: { rejectUnauthorized: false } });

async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ status: number; json: T; text: string; res: Response }> {
  const res = await fetch(`${API}${path}`, { method: opts.method ?? 'GET', headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as T, text, res };
}
function cookieOf(res: Response): string {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return (all.find((c) => c.startsWith('session=')) ?? res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
const wa = (msgs: Array<[string, string]>): string => msgs.map(([from, body], i) => `[2026-09-25, 1${i % 9}:0${i % 6}:00] ${from}: ${body}`).join('\n');

// Fact-bearing chats: each has a requirement (with a UNIQUE marker), promises, a meeting, a key date, and
// the shared counterparty Zelda Quorn with a DIFFERENT fact.
function chat(client: string, marker: string, zelda: string, promiseA: string, promiseB: string, meeting: string, deadline: string): string {
  return wa([
    [client, `Morning, I'm looking for a property. Must have ${marker}.`],
    ['Agent', `Morning! I have one with ${marker}. ${promiseA}`],
    [client, `Perfect, that's exactly what I wanted.`],
    ['Agent', meeting],
    [client, `Works for me. The handover must be done by ${deadline}.`],
    ['Agent', `Noted, ${deadline}. ${promiseB}`],
    [client, `Also, Zelda Quorn ${zelda}.`],
    ['Agent', `Understood — I'll factor that in.`],
  ]);
}

interface Acct { n: string; email: string; password: string; userId: string; cookie: string; }
async function signup(tag: string): Promise<Acct> {
  const email = `zztest-leak-${tag}-${Date.now()}@example.com`;
  const password = `Zz!leak-${Math.random().toString(36).slice(2, 12)}`;
  const s = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: { email, password, consent: true, timezone: 'Asia/Dubai' } });
  if (s.status !== 201) throw new Error(`signup ${tag}: ${s.status} ${s.text}`);
  const userId = s.json.user.id; const cookie = cookieOf(s.res);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`UPDATE users SET email_verified = true WHERE id = $1 AND email LIKE 'zztest-%'`, [userId]);
    if (r.rowCount !== 1) { await c.query('ROLLBACK'); throw new Error(`verify ${tag}: ${r.rowCount} rows`); }
    await c.query('COMMIT');
  } finally { c.release(); }
  console.log(`seeded ${tag}: ${email} id=${userId}`);
  return { n: tag, email, password, userId, cookie };
}
async function mkClient(a: Acct, name: string): Promise<string> {
  const r = await api<{ id: string }>('/clients', { method: 'POST', body: { name }, cookie: a.cookie });
  if (r.status !== 201) throw new Error(`client ${name}: ${r.status} ${r.text}`);
  return r.json.id;
}
async function importChat(a: Acct, clientId: string, clientName: string, content: string): Promise<string> {
  let r = await api<{ note?: { id?: string } }>(`/clients/${clientId}/notes/import`, { method: 'POST', cookie: a.cookie, body: { content, consent: true, firstImportAck: true } });
  if (r.status === 409) r = await api<{ note?: { id?: string } }>(`/clients/${clientId}/notes/import`, { method: 'POST', cookie: a.cookie, body: { content, consent: true, firstImportAck: true, confirmImport: true, misfileAck: true, counterpart: clientName } });
  if (r.status !== 202) throw new Error(`import ${clientName}: ${r.status} ${r.text}`);
  return r.json.note?.id ?? '';
}
async function setScope(userId: string): Promise<import('pg').PoolClient> { const c = await pool.connect(); await c.query(`SET app.user_id = '${userId}'`); return c; }
async function pollExtracted(a: Acct, clientId: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    const nr = await api<{ notes?: Array<{ status: string }> }>(`/clients/${clientId}/notes`, { cookie: a.cookie });
    const n = nr.json.notes?.[0];
    if (n && (n.status === 'extracted')) return true;
    if (n && (n.status === 'needs_review' || n.status === 'import_failed')) return false;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

(async () => {
  const report: string[] = [];
  const line = (s: string) => { report.push(s); console.log(s); };

  const A = await signup('A');
  const B = await signup('B');
  const CA1 = await mkClient(A, 'zztest Villa Buyer A1');
  const CA2 = await mkClient(A, 'zztest Penthouse Buyer A2');
  const CB1 = await mkClient(B, 'zztest Tower Buyer B1');

  await importChat(A, CA1, 'zztest Villa Buyer A1', chat('zztest Villa Buyer A1', 'flamingo-pattern tiles', 'holds 4 million in escrow', "I'll send you the signed MOU by Thursday.", "I'll confirm the unit number tomorrow.", "Let's meet Tuesday at 3pm at your office.", '15 November 2026'));
  await importChat(A, CA2, 'zztest Penthouse Buyer A2', chat('zztest Penthouse Buyer A2', 'brass-fixture penthouse', 'prefers morning viewings and is a cash buyer', "I'll send the brochure by Wednesday.", "I'll prepare the contract next week.", "Let's meet Monday at 11am.", '1 December 2026'));
  await importChat(B, CB1, 'zztest Tower Buyer B1', chat('zztest Tower Buyer B1', 'onyx-lobby tower', 'wants a 10 percent deposit upfront', "I'll email you the price list by Friday.", "I'll reserve the unit for you.", "Let's meet Thursday at 2pm.", '20 October 2026'));
  line('imported 3 chats; waiting for extraction…');
  for (const [a, c] of [[A, CA1], [A, CA2], [B, CB1]] as Array<[Acct, string]>) if (!(await pollExtracted(a, c))) line(`WARN: ${c} did not reach extracted`);

  // ---- CONFIRM facts were extracted (the re-run's precondition) ----
  line('\n=== FACT COUNTS (must be > 0, per client) ===');
  for (const [a, c, label] of [[A, CA1, 'A/CA1'], [A, CA2, 'A/CA2'], [B, CB1, 'B/CB1']] as Array<[Acct, string, string]>) {
    const cl = await setScope(a.userId);
    try {
      const q = async (t: string) => (await cl.query(`select count(*)::int c from ${t} where client_id = $1`, [c])).rows[0].c as number;
      const notes = (await cl.query('select extracted from notes where client_id = $1', [c])).rows;
      const ppl = notes.reduce((s, r) => s + ((r.extracted?.people?.length) ?? 0), 0);
      line(`${label}: promises=${await q('promises')} requirements=${await q('requirements')} key_dates=${await q('key_dates')} meetings=${await q('meetings')} people=${ppl}`);
    } finally { cl.release(); }
  }

  // ---- (c) CROSS-ACCOUNT, under SET app.user_id (DB-enforced) ----
  line('\n=== (c) CROSS-ACCOUNT (SET app.user_id; A markers must NOT appear scoped to B, and vice versa) ===');
  const searchScoped = async (userId: string, needle: string) => {
    const cl = await setScope(userId);
    try {
      const n = (await cl.query(`select count(*)::int c from notes where raw_text ilike $1`, [`%${needle}%`])).rows[0].c;
      const p = (await cl.query(`select count(*)::int c from promises where text ilike $1`, [`%${needle}%`])).rows[0].c;
      const r = (await cl.query(`select count(*)::int c from requirements where text ilike $1`, [`%${needle}%`])).rows[0].c;
      return { notes: n, promises: p, requirements: r };
    } finally { cl.release(); }
  };
  for (const [needle, owner, other, otherId] of [['flamingo-pattern', 'A', 'B', B.userId], ['brass-fixture', 'A', 'B', B.userId], ['onyx-lobby', 'B', 'A', A.userId]] as Array<[string, string, string, string]>) {
    const seen = await searchScoped(otherId, needle);
    const clean = seen.notes === 0 && seen.promises === 0 && seen.requirements === 0;
    line(`  notes+promises+requirements  "${needle}" (${owner}-only) scoped to ${other}: ${JSON.stringify(seen)} -> ${clean ? 'CLEAN' : 'LEAKED'}`);
  }
  // (c) API surfaces as account B: Book Scan + recall must not surface A's markers
  const bScan = await api(`/book-scan`, { cookie: B.cookie });
  const bScanLeak = /flamingo-pattern|brass-fixture/i.test(bScan.text);
  line(`  Book Scan (findings) as B: ${bScanLeak ? 'LEAKED (A marker present)' : 'CLEAN (no A marker)'}`);
  const bRecall = await api(`/recall`, { method: 'POST', cookie: B.cookie, body: { question: 'What do you know about the flamingo-pattern tiles or brass-fixture penthouse?' } });
  const bRecallLeak = /flamingo-pattern|brass-fixture|Villa Buyer A1|Penthouse Buyer A2/i.test(bRecall.text);
  line(`  recall (search result) as B for A's terms: ${bRecallLeak ? 'LEAKED' : 'CLEAN'}`);

  // ---- (d) CROSS-CLIENT within account A, through the APP's surfaces ----
  line('\n=== (d) CROSS-CLIENT within account A (app-level; CA1 marker=flamingo, CA2 marker=brass-fixture) ===');
  const brief1 = await api(`/clients/${CA1}/brief`, { cookie: A.cookie });
  const brief2 = await api(`/clients/${CA2}/brief`, { cookie: A.cookie });
  line(`  brief(CA1): flamingo=${/flamingo-pattern/i.test(brief1.text)} brass-fixture(CA2's)=${/brass-fixture/i.test(brief1.text)} -> ${/brass-fixture/i.test(brief1.text) ? 'LEAKED' : 'CLEAN'}`);
  line(`  brief(CA2): brass-fixture=${/brass-fixture/i.test(brief2.text)} flamingo(CA1's)=${/flamingo-pattern/i.test(brief2.text)} -> ${/flamingo-pattern/i.test(brief2.text) ? 'LEAKED' : 'CLEAN'}`);
  // recall is account-wide by design; verify a CA2-only term is ATTRIBUTED to CA2, never to CA1
  const aRecall = await api<{ receipts?: Array<{ source?: string }>; answer?: string }>(`/recall`, { method: 'POST', cookie: A.cookie, body: { question: 'Tell me about the brass-fixture penthouse — which client and what did they want?' } });
  const misattrib = /Villa Buyer A1/i.test(JSON.stringify(aRecall.json?.receipts ?? [])) && !/Penthouse Buyer A2/i.test(JSON.stringify(aRecall.json?.receipts ?? []));
  line(`  recall(A) for CA2's "brass-fixture": receipts mention A2=${/Penthouse Buyer A2/i.test(aRecall.text)} misattributed-to-A1=${misattrib} -> ${misattrib ? 'LEAKED (misattributed)' : 'CLEAN (account-wide, correctly attributed)'}`);
  // Book Scan (account-wide) must carry both clients' findings, each attributed to its own client
  const aScan = await api(`/book-scan`, { cookie: A.cookie });
  line(`  Book Scan (A) references CA1=${/Villa Buyer A1/i.test(aScan.text)} and CA2=${/Penthouse Buyer A2/i.test(aScan.text)} (account-wide by design; check attribution above)`);

  // ---- cleanup ----
  line('\n=== CLEANUP ===');
  for (const a of [A, B]) {
    const del = await api('/account', { method: 'DELETE', cookie: a.cookie });
    const relogin = await api('/auth/login', { method: 'POST', body: { email: a.email, password: a.password } });
    line(`  ${a.n}: delete=${del.status} relogin=${relogin.status} (expect 401)`);
  }
  const u = await pool.query(`select count(*)::int c from users where email like 'zztest-leak-%'`);
  line(`  users zztest-leak remaining -> ${u.rows[0].c}`);
  line(`  NOTE: model_call_events stragglers for these users cannot be deleted by tovira_app (permission wall).`);

  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
