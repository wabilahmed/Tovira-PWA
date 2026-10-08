/**
 * [LEAKAGE PASS 2] Inventory matches + outcome history. 2 accounts; A has 2 clients (CA1, CA2) with
 * DELIBERATELY SIMILAR requirements (so one item can match both — the cross-client attribution test),
 * B has 1 client (CB1). Both accounts get similar stock (so a cross-account leak, if any, would show
 * B's item against A's requirement). Per surface: CLEAN / LEAKED / NOT-CHECKED. Synthetic, cleaned up.
 */
import { Pool } from 'pg';
const API = 'https://staging.tovira.io/api';
const pool = new Pool({ connectionString: process.env.PROD_DB_URL, ssl: { rejectUnauthorized: false } });

async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ status: number; json: T; text: string; res: Response }> {
  const res = await fetch(`${API}${path}`, { method: opts.method ?? 'GET', headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as T, text, res };
}
const cookieOf = (res: Response): string => { const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []; return (all.find((c) => c.startsWith('session=')) ?? res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''; };
const wa = (msgs: Array<[string, string]>): string => msgs.map(([f, b], i) => `[2026-09-25, 1${i % 9}:0${i % 6}:00] ${f}: ${b}`).join('\n');
const reqChat = (client: string, marker: string): string => wa([
  [client, `I'm looking for a 3-bedroom villa with a direct sea view, budget around 4.5 million.`],
  ['Agent', `Noted — the ${marker} search.`],
  [client, `Yes, the ${marker}. A direct sea view is essential, around 4.5 million.`],
  ['Agent', `Understood, I'll look for a 3-bedroom sea-view villa near that price.`],
]);

interface Acct { n: string; email: string; password: string; userId: string; cookie: string; }
async function signup(tag: string): Promise<Acct> {
  const email = `zztest-inv-${tag}-${Date.now()}@example.com`; const password = `Zz!inv-${Math.random().toString(36).slice(2, 12)}`;
  const s = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: { email, password, consent: true, timezone: 'Asia/Dubai' } });
  if (s.status !== 201) throw new Error(`signup ${tag}: ${s.status} ${s.text}`);
  const userId = s.json.user.id; const cookie = cookieOf(s.res);
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await c.query(`UPDATE users SET email_verified=true WHERE id=$1 AND email LIKE 'zztest-%'`, [userId]); if (r.rowCount !== 1) { await c.query('ROLLBACK'); throw new Error(`verify ${tag}`); } await c.query('COMMIT'); } finally { c.release(); }
  console.log(`seeded ${tag}: ${email}`); return { n: tag, email, password, userId, cookie };
}
async function mkClient(a: Acct, name: string): Promise<string> { const r = await api<{ id: string }>('/clients', { method: 'POST', body: { name }, cookie: a.cookie }); if (r.status !== 201) throw new Error(`client ${name}: ${r.status}`); return r.json.id; }
async function importChat(a: Acct, clientId: string, name: string, content: string): Promise<void> {
  let r = await api(`/clients/${clientId}/notes/import`, { method: 'POST', cookie: a.cookie, body: { content, consent: true, firstImportAck: true } });
  if (r.status === 409) r = await api(`/clients/${clientId}/notes/import`, { method: 'POST', cookie: a.cookie, body: { content, consent: true, firstImportAck: true, confirmImport: true, misfileAck: true, counterpart: name } });
  if (r.status !== 202) throw new Error(`import ${name}: ${r.status} ${r.text}`);
}
async function pollReqs(a: Acct, clientId: string): Promise<number> {
  for (let i = 0; i < 60; i++) {
    const c = await pool.connect();
    try { await c.query(`SET app.user_id='${a.userId}'`); const n = (await c.query('select count(*)::int c from requirements where client_id=$1', [clientId])).rows[0].c; if (n > 0) return n; } finally { c.release(); }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 0;
}

(async () => {
  const line = (s: string) => console.log(s);
  const A = await signup('A'); const B = await signup('B');
  const CA1 = await mkClient(A, 'zztest Villa Buyer A1'); const CA2 = await mkClient(A, 'zztest Villa Buyer A2'); const CB1 = await mkClient(B, 'zztest Villa Buyer B1');
  await importChat(A, CA1, 'zztest Villa Buyer A1', reqChat('zztest Villa Buyer A1', 'flamingo-tile villa'));
  await importChat(A, CA2, 'zztest Villa Buyer A2', reqChat('zztest Villa Buyer A2', 'brass-rail villa'));
  await importChat(B, CB1, 'zztest Villa Buyer B1', reqChat('zztest Villa Buyer B1', 'onyx-lobby villa'));
  line('imported; waiting for requirements to extract…');
  for (const [a, c, l] of [[A, CA1, 'CA1'], [A, CA2, 'CA2'], [B, CB1, 'CB1']] as Array<[Acct, string, string]>) line(`  ${l} requirements=${await pollReqs(a, c)}`);

  // Create similar stock in both accounts — item-create triggers matching (direction 2) synchronously.
  const desc = 'spacious 3-bedroom villa with a direct sea view, priced around 4.5 million';
  const itemA = await api<{ id: string; quantity: number }>('/inventory', { method: 'POST', cookie: A.cookie, body: { title: '3-bedroom sea-view villa', description: desc, quantity: 3 } });
  const itemB = await api<{ id: string; quantity: number }>('/inventory', { method: 'POST', cookie: B.cookie, body: { title: '3-bedroom sea-view villa', description: desc.replace('4.5', '4.6'), quantity: 2 } });
  line(`\ncreated items: A=${itemA.json.id} (qty ${itemA.json.quantity}) B=${itemB.json.id} (qty ${itemB.json.quantity})`);

  line('\n=== INVENTORY (c) CROSS-ACCOUNT ===');
  const mA = await api<{ suggestions?: Array<{ itemId: string; clientId: string; receipt?: { requirementRaw?: string } }> }>('/inventory/matches', { cookie: A.cookie });
  const mB = await api<{ suggestions?: Array<{ itemId: string; clientId: string; receipt?: { requirementRaw?: string } }> }>('/inventory/matches', { cookie: B.cookie });
  const sugA = mA.json.suggestions ?? []; const sugB = mB.json.suggestions ?? [];
  line(`  A rep-suggestions: ${sugA.length} (itemIds: ${[...new Set(sugA.map((s) => s.itemId))].join(',') || 'none'})`);
  line(`  B rep-suggestions: ${sugB.length} (itemIds: ${[...new Set(sugB.map((s) => s.itemId))].join(',') || 'none'})`);
  const aRefsB = sugA.some((s) => s.itemId === itemB.json.id); const bRefsA = sugB.some((s) => s.itemId === itemA.json.id);
  line(`  A's list contains B's item? ${aRefsB ? 'LEAKED' : 'CLEAN'}   B's list contains A's item? ${bRefsA ? 'LEAKED' : 'CLEAN'}`);
  // Also under SET (DB-enforced): inventory_matches never crosses users
  const cl = await pool.connect();
  try { await cl.query(`SET app.user_id='${B.userId}'`); const leak = (await cl.query(`select count(*)::int c from inventory_matches where item_id=$1`, [itemA.json.id])).rows[0].c; line(`  inventory_matches for A's item, scoped to B (SET): ${leak} -> ${leak === 0 ? 'CLEAN' : 'LEAKED'}`); } finally { cl.release(); }

  line('\n=== INVENTORY (d) CROSS-CLIENT ATTRIBUTION (A\'s one item may match both CA1 and CA2) ===');
  const sC1 = await api<{ suggestions?: Array<{ itemId: string; receipt?: { requirementRaw?: string } }> }>(`/inventory/matches?clientId=${CA1}`, { cookie: A.cookie });
  const sC2 = await api<{ suggestions?: Array<{ itemId: string; receipt?: { requirementRaw?: string } }> }>(`/inventory/matches?clientId=${CA2}`, { cookie: A.cookie });
  const r1 = (sC1.json.suggestions ?? []).map((s) => s.receipt?.requirementRaw ?? '').join(' | ');
  const r2 = (sC2.json.suggestions ?? []).map((s) => s.receipt?.requirementRaw ?? '').join(' | ');
  line(`  CA1 suggestions=${sC1.json.suggestions?.length ?? 0} receipt-has-flamingo=${/flamingo/i.test(r1)} receipt-has-brass(CA2's)=${/brass-rail/i.test(r1)} -> ${/brass-rail/i.test(r1) ? 'LEAKED (CA2 receipt under CA1)' : 'CLEAN'}`);
  line(`  CA2 suggestions=${sC2.json.suggestions?.length ?? 0} receipt-has-brass=${/brass-rail/i.test(r2)} receipt-has-flamingo(CA1's)=${/flamingo/i.test(r2)} -> ${/flamingo/i.test(r2) ? 'LEAKED (CA1 receipt under CA2)' : 'CLEAN'}`);
  // never reserves/decrements
  const itemAafter = await api<{ quantity: number }>(`/inventory/${itemA.json.id}`, { cookie: A.cookie });
  line(`  A item quantity: before=3 after-matching=${itemAafter.json.quantity} -> ${itemAafter.json.quantity === 3 ? 'CLEAN (no reserve/decrement)' : 'LEAKED (stock changed)'}`);

  line('\n=== OUTCOME HISTORY ===');
  await api(`/clients/${CA1}/outcome`, { method: 'POST', cookie: A.cookie, body: { outcome: 'won' } });
  await api(`/clients/${CA2}/outcome`, { method: 'POST', cookie: A.cookie, body: { outcome: 'lost' } });
  await api(`/clients/${CB1}/outcome`, { method: 'POST', cookie: B.cookie, body: { outcome: 'won' } });
  const gc = async (a: Acct, id: string) => (await api<{ outcome?: string }>(`/clients/${id}`, { cookie: a.cookie })).json.outcome ?? 'none';
  line(`  (d) cross-client: CA1 outcome=${await gc(A, CA1)} (want won)  CA2 outcome=${await gc(A, CA2)} (want lost_confirmed) -> ${(await gc(A, CA1)) === 'won' && (await gc(A, CA2)) === 'lost_confirmed' ? 'CLEAN (each attributed correctly)' : 'CHECK'}`);
  const crossGet = await api(`/clients/${CB1}`, { cookie: A.cookie }); // A trying to read B's client
  line(`  (c) cross-account: A GET B's client -> HTTP ${crossGet.status} (expect 404) -> ${crossGet.status === 404 ? 'CLEAN' : 'LEAKED'}`);
  const cl2 = await pool.connect();
  try { await cl2.query(`SET app.user_id='${A.userId}'`); const c = (await cl2.query(`select count(*)::int c from clients where id=$1`, [CB1])).rows[0].c; line(`  (c) clients row for B's CB1, scoped to A (SET): ${c} -> ${c === 0 ? 'CLEAN' : 'LEAKED'}`); } finally { cl2.release(); }

  line('\n=== CLEANUP ===');
  for (const a of [A, B]) { const d = await api('/account', { method: 'DELETE', cookie: a.cookie }); const rl = await api('/auth/login', { method: 'POST', body: { email: a.email, password: a.password } }); line(`  ${a.n}: delete=${d.status} relogin=${rl.status}`); }
  const u = await pool.query(`select count(*)::int c from users where email like 'zztest-inv-%'`); line(`  users zztest-inv remaining -> ${u.rows[0].c}`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
