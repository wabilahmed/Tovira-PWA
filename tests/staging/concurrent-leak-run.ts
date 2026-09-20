/**
 * BATCH B — concurrent two-account leak test (standalone runner, NOT part of the
 * sequential `npm run test:staging` suite, which deliberately never races two identities).
 *
 * Purpose: prove two accounts running extractions SIMULTANEOUSLY against the deployed
 * environment cannot see each other's data. Targets concurrency-only leak classes that a
 * sequential IDOR sweep (a5-money-isolation) cannot reach: connection-pool bleed, cached
 * request/response context, shared in-process structures, advisory-lock cross-job
 * collisions, and a shared embedding/vector index.
 *
 * SAFETY (rail #1/#3/#5): every account, email, client, sentinel and inventory item is
 * synthetic and prefixed ZZTEST-LEAK. Both accounts are created by this run and torn down
 * in a `finally` (and their credentials are written to a state file the moment they exist,
 * so a crash can never orphan them). It reuses lib/env's target guard.
 *
 * Run (against the DEPLOYED environment, explicitly authorised for this batch):
 *   STAGING_API_URL=https://dyxluteuo1xg6.cloudfront.net/api \
 *   STAGING_APP_URL=https://dyxluteuo1xg6.cloudfront.net \
 *   QA_EMAIL_DOMAIN=qa.tovira.io \
 *   npx tsx tests/staging/concurrent-leak-run.ts
 *
 * Env knobs: LEAK_ROUNDS (default 12), LEAK_KEEP=1 (skip teardown for inspection).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveTarget } from './lib/env.js';
import { HttpClient } from './lib/http.js';
import { IdentityFactory, type Identity } from './lib/identity.js';

const OUT = process.env.LEAK_RESULTS_FILE || 'tests/staging/.results/concurrent-leak.jsonl';
const ROUNDS = Math.max(12, Number(process.env.LEAK_ROUNDS ?? 12));
const STATE_FILE = 'tests/staging/.results/concurrent-leak-accounts.json';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, '');

type Verdict = 'CLEAN' | 'LEAKED' | 'AMBIGUOUS';
interface SurfaceResult { surface: string; verdict: Verdict; detail: string }
const surfaceResults: SurfaceResult[] = [];
function log(event: string, data: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), event, ...data };
  appendFileSync(OUT, `${JSON.stringify(line)}\n`);
  console.log(`  ${event}${Object.keys(data).length ? ` · ${JSON.stringify(data)}` : ''}`);
}
function record(surface: string, verdict: Verdict, detail: string): void {
  surfaceResults.push({ surface, verdict, detail });
  const mark = verdict === 'CLEAN' ? '✅' : verdict === 'LEAKED' ? '⛔ LEAK' : '⚠️  AMBIGUOUS';
  log('surface', { surface, verdict, detail });
  console.log(`  ${mark}  ${surface} — ${detail}`);
}

// ---- The two accounts' planted, DISTINCT data. Same counterparty NAME, different facts. ----
const SHARED_COUNTERPARTY = 'Kai Sterling';
const A = {
  tag: 'ALPHA',
  sentinel: 'SENTINEL-ALPHA-A7',
  clientName: 'ZZTEST-LEAK Marina Heights',
  // A's secrets — must NEVER appear on B's surfaces.
  cashFact: 'AED 9,000,000 in cash',
  secretTokens: ['SENTINEL-ALPHA-A7', '9,000,000', 'Marina Heights'],
  inventoryTitle: 'ZZTEST-LEAK 2-bed at Marina Heights',
  budget: 'AED 2.1M',
};
const B = {
  tag: 'BRAVO',
  sentinel: 'SENTINEL-BRAVO-B3',
  clientName: 'ZZTEST-LEAK Marina Gardens',
  cashFact: 'needs a strictly shellfish-free venue',
  secretTokens: ['SENTINEL-BRAVO-B3', 'shellfish-free', 'Marina Gardens'],
  inventoryTitle: 'ZZTEST-LEAK 2-bed at Marina Gardens',
  budget: 'AED 3.4M',
};

// Varied note shapes for the concurrent rounds — each carries its account's sentinel so a
// leak is detectable by a simple substring scan of the *other* account's surfaces.
function noteShapes(acct: typeof A): string[] {
  const s = acct.sentinel;
  return [
    `Met ${SHARED_COUNTERPARTY} at ${acct.clientName}. ${SHARED_COUNTERPARTY} ${acct.cashFact}. ${s}. I promised to send the brochure by next Tuesday.`,
    `Call with ${acct.clientName}. Budget is ${acct.budget} for a 2-bed. ${s}. Follow up Thursday.`,
    `${acct.clientName} update ${s}: they were happy with the viewing. Ana ba3at el details bukra (will send tomorrow).`,
    `Note ${s}: ${SHARED_COUNTERPARTY} asked about payment plans. Nothing firm on dates yet — circle back sometime.`,
    `${acct.clientName} ${s}: confirmed the 2-bed requirement, ${acct.budget}. Wants to close this quarter.`,
    `Quick one ${s}: ${SHARED_COUNTERPARTY} ${acct.cashFact}. Will call them Monday.`,
  ];
}

async function createClient(rep: Identity, name: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>('/clients', { name });
  if (res.status !== 201 || !res.body?.id) throw new Error(`create client failed: ${rep.http.lastExchange()}`);
  return res.body.id;
}
async function pasteNote(rep: Identity, clientId: string, text: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>(`/clients/${clientId}/notes/paste`, { text });
  if (res.status !== 201 || !res.body?.id) throw new Error(`paste failed: ${rep.http.lastExchange()}`);
  return res.body.id;
}
async function createInventory(rep: Identity, title: string, description: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>('/inventory', { title, description, quantity: 1 });
  if (res.status !== 201 || !res.body?.id) throw new Error(`inventory create failed: ${rep.http.lastExchange()}`);
  return res.body.id;
}

// Scan a whole HTTP response's raw text for any of the FOREIGN account's secret tokens.
function scanForForeign(rawText: string, foreign: typeof A | typeof B): string[] {
  return foreign.secretTokens.filter((t) => rawText.includes(t));
}

interface Seeded { A: Identity; B: Identity; clientA: string; clientB: string; runId: string }

async function seed(factory: IdentityFactory): Promise<Seeded> {
  log('seed:start');
  const dom = process.env.QA_EMAIL_DOMAIN || 'qa.tovira.io';
  // Persist credentials the instant EACH account exists so even a hard kill can't orphan them.
  const persist = () => writeFileSync(STATE_FILE, JSON.stringify(
    { createdAt: new Date().toISOString(), accounts: factory.all().map((r) => ({ email: r.email, password: r.password, userId: r.userId })) }, null, 2));
  const repA = await factory.newRep({ emailOverride: `qa+zztest-leaktest-alpha-${factory.runId}@${dom}` });
  persist();
  const repB = await factory.newRep({ emailOverride: `qa+zztest-leaktest-bravo-${factory.runId}@${dom}` });
  persist();
  log('seed:accounts', { A: repA.email, B: repB.email });

  const clientA = await createClient(repA, A.clientName);
  const clientB = await createClient(repB, B.clientName);
  // Baseline notes establishing the shared-counterparty collision with DISTINCT facts.
  const bnA = await pasteNote(repA, clientA, `Baseline ${A.sentinel}: ${SHARED_COUNTERPARTY} ${A.cashFact}. 2-bed at ${A.clientName}, budget ${A.budget}.`);
  const bnB = await pasteNote(repB, clientB, `Baseline ${B.sentinel}: ${SHARED_COUNTERPARTY} ${B.cashFact}. 2-bed at ${B.clientName}, budget ${B.budget}.`);
  await Promise.all([repA.http.post(`/notes/${bnA}/extract`), repB.http.post(`/notes/${bnB}/extract`)]);
  // Inventory items — each account's own 2-bed, for the matching (vector) surface.
  await createInventory(repA, A.inventoryTitle, `Two-bedroom apartment, ${A.budget} range. ${A.sentinel}. Sea view.`);
  await createInventory(repB, B.inventoryTitle, `Two-bedroom apartment, ${B.budget} range. ${B.sentinel}. Garden view.`);

  log('seed:done', {
    baseline: {
      A: { client: A.clientName, sentinel: A.sentinel, fact: `${SHARED_COUNTERPARTY} ${A.cashFact}`, budget: A.budget, inventory: A.inventoryTitle },
      B: { client: B.clientName, sentinel: B.sentinel, fact: `${SHARED_COUNTERPARTY} ${B.cashFact}`, budget: B.budget, inventory: B.inventoryTitle },
    },
  });
  return { A: repA, B: repB, clientA, clientB, runId: factory.runId };
}

async function main(): Promise<void> {
  const target = resolveTarget();
  console.log(`\n━━━ CONCURRENT LEAK TEST ━━━\n  API : ${target.apiBase}  (host ${target.apiHost})\n  rounds: ${ROUNDS}\n`);
  const health = await new HttpClient(target).get<{ status?: string }>('/health');
  log('health', { status: health.status, body: health.body });

  const factory = new IdentityFactory(target);
  let seeded: Seeded | null = null;
  try {
    seeded = await seed(factory);
    const { A: repA, B: repB, clientA, clientB } = seeded;
    const shapesA = noteShapes(A);
    const shapesB = noteShapes(B);

    // ---- TASK 3: concurrent extraction rounds (in-flight simultaneously via Promise.all) ----
    let sharedRoundDone = false;
    for (let r = 0; r < ROUNDS; r++) {
      // A shared-counterparty round: force both to extract a Kai-Sterling note at once.
      const forceShared = r === Math.floor(ROUNDS / 2);
      const textA = forceShared ? `${A.sentinel}: ${SHARED_COUNTERPARTY} ${A.cashFact}, budget ${A.budget}.` : shapesA[r % shapesA.length]!;
      const textB = forceShared ? `${B.sentinel}: ${SHARED_COUNTERPARTY} ${B.cashFact}, budget ${B.budget}.` : shapesB[r % shapesB.length]!;
      const [nA, nB] = await Promise.all([pasteNote(repA, clientA, textA), pasteNote(repB, clientB, textB)]);
      // The concurrency that matters: two tenants' extractions in-flight at the same instant.
      const [exA, exB] = await Promise.all([
        repA.http.post<{ status: string }>(`/notes/${nA}/extract`),
        repB.http.post<{ status: string }>(`/notes/${nB}/extract`),
      ]);
      if (forceShared) sharedRoundDone = true;
      log('round', { r, forceShared, A: exA.status, B: exB.status });
    }
    log('rounds:done', { rounds: ROUNDS, sharedRoundDone });

    // ---- Round S: concurrent extraction OVERLAPPING a scheduled job (the 15s notes-sweep,
    // a real ScheduledBrain job on a global advisory lock) + per-tenant scan/digest logic. ----
    // Paste sentinel notes WITHOUT calling /extract, so the BACKGROUND sweep extracts them
    // while /scan + /monday-digest run concurrently for both tenants.
    const [sA, sB] = await Promise.all([
      pasteNote(repA, clientA, `Round-S ${A.sentinel}: ${SHARED_COUNTERPARTY} ${A.cashFact}. Sweep should extract this.`),
      pasteNote(repB, clientB, `Round-S ${B.sentinel}: ${SHARED_COUNTERPARTY} ${B.cashFact}. Sweep should extract this.`),
    ]);
    const sched = await Promise.all([
      repA.http.post('/scan'), repB.http.post('/scan'),
      repA.http.get('/monday-digest'), repB.http.get('/monday-digest'),
    ]);
    log('roundS:scheduled', { scanA: sched[0].status, scanB: sched[1].status, digestA: sched[2].status, digestB: sched[3].status });
    // Wait for the background sweep to advance both notes (proves the scheduled job ran in-window).
    const sweepStatus = await waitSweep(repA, clientA, sA, repB, clientB, sB);
    log('roundS:sweep', sweepStatus);

    // ---- TASK 4: per-surface leakage verification ----
    await verify(repA, clientA, repB, clientB, sharedRoundDone);
  } finally {
    if (!process.env.LEAK_KEEP) {
      const td = await factory.teardownAll();
      log('teardown', td);
      // Confirm both accounts are actually gone (login must fail).
      if (seeded) {
        const anon = new HttpClient(target);
        const relA = await anon.post('/auth/login', { email: seeded.A.email, password: seeded.A.password });
        const relB = await anon.post('/auth/login', { email: seeded.B.email, password: seeded.B.password });
        log('teardown:verify', { A_login: relA.status, B_login: relB.status });
      }
    } else {
      log('teardown:skipped', { reason: 'LEAK_KEEP set' });
    }
  }

  // ---- Summary ----
  const leaked = surfaceResults.filter((s) => s.verdict === 'LEAKED');
  const ambiguous = surfaceResults.filter((s) => s.verdict === 'AMBIGUOUS');
  console.log(`\n━━━ RESULT ━━━\n  surfaces checked: ${surfaceResults.length}\n  CLEAN: ${surfaceResults.filter((s) => s.verdict === 'CLEAN').length}  LEAKED: ${leaked.length}  AMBIGUOUS: ${ambiguous.length}`);
  log('summary', { checked: surfaceResults.length, leaked: leaked.length, ambiguous: ambiguous.length });
  if (leaked.length) process.exitCode = 2;
}

async function waitSweep(repA: Identity, cA: string, nA: string, repB: Identity, cB: string, nB: string, timeoutMs = 90_000): Promise<{ A: string; B: string }> {
  const deadline = Date.now() + timeoutMs;
  const stat = async (rep: Identity, c: string, n: string): Promise<string> => {
    const res = await rep.http.get<{ notes: Array<{ id: string; status: string }> }>(`/clients/${c}/notes`);
    return res.body.notes.find((x) => x.id === n)?.status ?? 'unknown';
  };
  for (;;) {
    const [a, b] = await Promise.all([stat(repA, cA, nA), stat(repB, cB, nB)]);
    const done = (s: string) => s !== 'pending_extraction' && s !== 'pending_transcription' && s !== 'unknown';
    if (done(a) && done(b)) return { A: a, B: b };
    if (Date.now() > deadline) return { A: a, B: b };
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function verify(repA: Identity, clientA: string, repB: Identity, clientB: string, sharedRoundDone: boolean): Promise<void> {
  // 1) FACTS — each account's own notes must contain only its own sentinel, never the other's.
  const notesA = await repA.http.get<{ notes: unknown[] }>(`/clients/${clientA}/notes`);
  const notesB = await repB.http.get<{ notes: unknown[] }>(`/clients/${clientB}/notes`);
  const fA = scanForForeign(notesA.rawText, B);
  const fB = scanForForeign(notesB.rawText, A);
  record('facts (own notes/extracted)', fA.length || fB.length ? 'LEAKED' : 'CLEAN',
    fA.length || fB.length ? `A saw B tokens ${JSON.stringify(fA)}; B saw A tokens ${JSON.stringify(fB)}` : 'each account sees only its own sentinel & facts');

  // 2) BRIEF — per-client context.
  const briefA = await repA.http.get(`/clients/${clientA}/brief`);
  const briefB = await repB.http.get(`/clients/${clientB}/brief`);
  const bfA = scanForForeign(briefA.rawText, B); const bfB = scanForForeign(briefB.rawText, A);
  record('brief (recentContext/openPromises)', bfA.length || bfB.length ? 'LEAKED' : 'CLEAN',
    bfA.length || bfB.length ? `cross tokens A:${JSON.stringify(bfA)} B:${JSON.stringify(bfB)}` : 'briefs carry only own-client context');

  // 3) PROMISES — the global promises list.
  const promA = await repA.http.get('/promises'); const promB = await repB.http.get('/promises');
  const pfA = scanForForeign(promA.rawText, B); const pfB = scanForForeign(promB.rawText, A);
  record('promises (global list)', pfA.length || pfB.length ? 'LEAKED' : 'CLEAN',
    pfA.length || pfB.length ? `cross tokens A:${JSON.stringify(pfA)} B:${JSON.stringify(pfB)}` : 'each rep sees only own promises');

  // 4) RECALL / ASK — ask each account for the OTHER's secret. The answer must refuse or stay
  //    within own data; receipts must never quote the foreign account, and every receipt's
  //    noteId must belong to the asking account.
  const ownNoteIds = async (rep: Identity, c: string): Promise<Set<string>> => {
    const res = await rep.http.get<{ notes: Array<{ id: string }> }>(`/clients/${c}/notes`);
    return new Set(res.body.notes.map((n) => n.id));
  };
  const ownA = await ownNoteIds(repA, clientA); const ownB = await ownNoteIds(repB, clientB);
  // B asks for A's cash position; A asks for B's venue requirement.
  const recallB = await repB.http.post<{ answer: string; receipts: Array<{ quote: string; noteId: string }> }>('/recall', { question: `What is ${SHARED_COUNTERPARTY}'s cash position and budget?` });
  const recallA = await repA.http.post<{ answer: string; receipts: Array<{ quote: string; noteId: string }> }>('/recall', { question: `What venue or dietary requirement does ${SHARED_COUNTERPARTY} have?` });
  const recallLeakB = scanForForeign(recallB.rawText, A); // B must not see A's 9,000,000 / SENTINEL-ALPHA
  const recallLeakA = scanForForeign(recallA.rawText, B); // A must not see B's shellfish-free / SENTINEL-BRAVO
  const foreignReceiptB = (recallB.body.receipts ?? []).filter((r) => !ownB.has(r.noteId));
  const foreignReceiptA = (recallA.body.receipts ?? []).filter((r) => !ownA.has(r.noteId));
  const recallLeaked = recallLeakB.length || recallLeakA.length || foreignReceiptB.length || foreignReceiptA.length;
  record('recall/Ask (answer + receipts)', recallLeaked ? 'LEAKED' : 'CLEAN',
    recallLeaked ? `B-answer foreign:${JSON.stringify(recallLeakB)} A-answer foreign:${JSON.stringify(recallLeakA)} foreignReceipts A:${foreignReceiptA.length} B:${foreignReceiptB.length}`
      : `neither answer surfaces the other's secret; all receipts belong to the asking account (A receipts=${recallA.body.receipts?.length ?? 0}, B receipts=${recallB.body.receipts?.length ?? 0})`);

  // 5) EMBEDDINGS / VECTOR INDEX — exercised via recall receipts (above) AND inventory matching (below).
  //    A stubbed embedder yields 0 receipts; that makes the recall-index check AMBIGUOUS, not clean.
  const recallEmpty = (recallA.body.receipts?.length ?? 0) === 0 && (recallB.body.receipts?.length ?? 0) === 0;
  record('embedding/vector via recall', recallLeaked ? 'LEAKED' : recallEmpty ? 'AMBIGUOUS' : 'CLEAN',
    recallLeaked ? 'foreign content retrieved from the vector index'
      : recallEmpty ? 'both recalls returned 0 receipts — embedder may be stubbed here; index isolation UNVERIFIABLE via recall (see inventory-matching surface)'
        : 'on-topic retrieval returned only own-account receipts');

  // 6) TODAY / daily list.
  const todayA = await repA.http.get('/today'); const todayB = await repB.http.get('/today');
  const tfA = scanForForeign(todayA.rawText, B); const tfB = scanForForeign(todayB.rawText, A);
  record('today (daily list)', tfA.length || tfB.length ? 'LEAKED' : 'CLEAN',
    tfA.length || tfB.length ? `cross tokens A:${JSON.stringify(tfA)} B:${JSON.stringify(tfB)}` : 'daily list scoped to own account');

  // 7) MONDAY / daily digest.
  const digA = await repA.http.get('/monday-digest'); const digB = await repB.http.get('/monday-digest');
  const dfA = scanForForeign(digA.rawText, B); const dfB = scanForForeign(digB.rawText, A);
  record('monday/daily digest', dfA.length || dfB.length ? 'LEAKED' : 'CLEAN',
    dfA.length || dfB.length ? `cross tokens A:${JSON.stringify(dfA)} B:${JSON.stringify(dfB)}` : 'digest counts & content scoped to own account');

  // 8) SCAN counts (idempotency + no cross content). Run under the same session.
  const scanA = await repA.http.post<Record<string, number>>('/scan');
  const scanB = await repB.http.post<Record<string, number>>('/scan');
  const scfA = scanForForeign(scanA.rawText, B); const scfB = scanForForeign(scanB.rawText, A);
  record('scan (outcomes/counts)', scfA.length || scfB.length ? 'LEAKED' : 'CLEAN',
    scfA.length || scfB.length ? `cross tokens A:${JSON.stringify(scfA)} B:${JSON.stringify(scfB)}` : `scan bodies carry no foreign content (A=${scanA.status} B=${scanB.status})`);

  // 9) LEDGER / history.
  const ledA = await repA.http.get('/ledger'); const ledB = await repB.http.get('/ledger');
  const lfA = scanForForeign(ledA.rawText, B); const lfB = scanForForeign(ledB.rawText, A);
  record('ledger/outcomes history', lfA.length || lfB.length ? 'LEAKED' : 'CLEAN',
    lfA.length || lfB.length ? `cross tokens A:${JSON.stringify(lfA)} B:${JSON.stringify(lfB)}` : 'ledger scoped to own account');

  // 10) INVENTORY LIST + MATCHING (the shared vector index, the sharpest concurrency-leak surface).
  const invListA = await repA.http.get('/inventory'); const invListB = await repB.http.get('/inventory');
  const ilfA = scanForForeign(invListA.rawText, B); const ilfB = scanForForeign(invListB.rawText, A);
  record('inventory list', ilfA.length || ilfB.length ? 'LEAKED' : 'CLEAN',
    ilfA.length || ilfB.length ? `cross items A:${JSON.stringify(ilfA)} B:${JSON.stringify(ilfB)}` : 'each rep lists only own items');
  const matchA = await repA.http.get<{ suggestions?: unknown[] }>('/inventory/matches');
  const matchB = await repB.http.get<{ suggestions?: unknown[] }>('/inventory/matches');
  const mfA = scanForForeign(matchA.rawText, B); const mfB = scanForForeign(matchB.rawText, A);
  const matchEmpty = (matchA.body.suggestions?.length ?? 0) === 0 && (matchB.body.suggestions?.length ?? 0) === 0;
  record('inventory matching (vector index)', mfA.length || mfB.length ? 'LEAKED' : matchEmpty ? 'AMBIGUOUS' : 'CLEAN',
    mfA.length || mfB.length ? `A matched B item ${JSON.stringify(mfA)}; B matched A item ${JSON.stringify(mfB)}`
      : matchEmpty ? 'both returned 0 suggestions — matching may be gated/stubbed here; cross-tenant match UNVERIFIABLE (record AMBIGUOUS, not clean)'
        : 'each rep only matched against own inventory');

  // 11) SHARED-COUNTERPARTY SEPARATION — A's Kai facts must never carry B's, and vice versa.
  const aHasOwn = notesA.rawText.includes(A.cashFact); const aHasForeign = notesA.rawText.includes(B.cashFact);
  const bHasOwn = notesB.rawText.includes(B.cashFact); const bHasForeign = notesB.rawText.includes(A.cashFact);
  const collisionLeak = aHasForeign || bHasForeign;
  record('shared-counterparty separation', collisionLeak ? 'LEAKED' : (aHasOwn && bHasOwn ? 'CLEAN' : 'AMBIGUOUS'),
    collisionLeak ? `name collision merged facts (A has B-fact:${aHasForeign}, B has A-fact:${bHasForeign})`
      : (aHasOwn && bHasOwn ? `both accounts keep their own "${SHARED_COUNTERPARTY}" facts separate (A=cash, B=venue) despite the identical name${sharedRoundDone ? ' (incl. the simultaneous shared-counterparty extraction round)' : ''}`
        : 'expected own facts not both present — data may not have persisted; treat as AMBIGUOUS'));

  // 12) BOOK-SCAN (aggregate read) as a bonus surface.
  const bsA = await repA.http.get('/book-scan'); const bsB = await repB.http.get('/book-scan');
  const bsfA = scanForForeign(bsA.rawText, B); const bsfB = scanForForeign(bsB.rawText, A);
  record('book-scan (aggregate)', bsfA.length || bsfB.length ? 'LEAKED' : 'CLEAN',
    bsfA.length || bsfB.length ? `cross tokens A:${JSON.stringify(bsfA)} B:${JSON.stringify(bsfB)}` : 'aggregate reads scoped to own account');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
