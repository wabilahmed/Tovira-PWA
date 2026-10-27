import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { discoveredRoutes, matchesRoute } from '../test-support/route-discovery.js';
import { seedPerson, type PersonIds } from '../test-support/erasure-fixture.js';
import { FIND_QUERIES } from '../services/find/find-service.js';

/**
 * [P47 · owner] The erasure guard finds rep-facing surfaces BY ITSELF. P40's guard listed every route, but a listed
 * probe proved nothing when the fixture never put the restricted person's words on that surface: Inventory suggestions
 * and Today's match card leaked while their probes returned nothing to find.
 *
 * Two people get the same full set of data: Khalid (restricted, every word carries RESTRICTED) and Omar (not
 * restricted, every word carries CONTROL). Then EVERY route the API serves is fetched, with every real id put in its
 * parameters and every query parameter the app sends:
 *  - a surface that shows CONTROL but not RESTRICTED before the restriction is a FIXTURE GAP: the guard cannot see that
 *    surface, so it fails until the fixture reaches it;
 *  - a surface that shows neither must be listed as showing no person text, with its reason, and the claim is
 *    re-checked on every run (it fails the moment the surface starts showing person text);
 *  - after the restriction opens, RESTRICTED appears nowhere, the export included ([P48 · owner]), and CONTROL still
 *    appears wherever it did (nothing over-withheld).
 * The POST routes that read (receipts, the Today refresh) are probed the same way. And every API path the web app
 * calls must be one of the discovered routes, so no renderer reads from a source this guard does not sweep.
 */
const RESTRICTED = 'ZEBRAQUARTZ';
const CONTROL = 'MOONLITCEDAR';

/** Surfaces that show no person-derived text, with why (re-checked: neither marker may appear). */
const NO_PERSON_TEXT: Record<string, string> = {
  // the rep's own account and settings
  '/me': 'the rep\'s own profile', '/me/tour': 'tour progress', '/me/ui-prefs': 'UI preferences', '/me/access-answers': 'the rep\'s own answers about their business',
  '/allowance/status': 'usage numbers', '/share-card': 'counts only', '/push/config': 'the VAPID public key', '/onboarding/status': 'counts and flags',
  '/version': 'build info', '/health': 'liveness', '/healthz': 'liveness',
  // counts and gates
  '/hero/status': 'counts (the insights gate)', '/corpus-stats': 'counts', '/notes/:id/move-preview': 'counts of what a move carries',
  '/import/bulk/:id/status': 'an import batch in progress: file names and counts',
  // what the rep entered, never a third party's words
  '/clients': 'client names the rep entered (a third party is never a client row)', '/clients/:id': 'a client record the rep entered',
  '/cold': 'client records and silence days', '/clients/status-suggestions': 'status words and silence days',
  '/inventory': 'the rep\'s own listings', '/inventory/:id': 'a listing', '/inventory/:id/shares': 'share history: client ids and outcomes',
  '/inventory/by-client/:id': 'the rep\'s listings shared with a client',
  '/captures': 'statements the rep typed (a mention of a person is kept by the existing about-versus-mention rule)',
  '/clients/:id/images': 'photos (removed in P36): always empty',
  '/hero/patterns': 'parked: empty unless PATTERNS_ENABLED',
};

type Probe = { route: string; body: (i: PersonIds) => unknown };
/** The POST routes that READ (return person-derived text). Every other POST is a write. */
const POST_READS: Probe[] = [
  { route: '/receipts/sources', body: (i) => ({ refs: [{ noteId: i.noteId, clientId: i.clientId, span: 'here, looking for a 4BR villa', quote: 'here, looking for a 4BR villa' }] }) },
  { route: '/receipts/thread', body: (i) => ({ ref: { noteId: i.noteId, clientId: i.clientId }, full: true }) },
  { route: '/receipts/conversation', body: (i) => ({ noteId: i.noteId }) },
  { route: '/today/refresh', body: () => ({}) },
];

/** API paths the web app calls (its *Client.ts files), with the query parameters it sends. */
function webCalls(): { paths: string[]; queries: Array<{ path: string; param: string }> } {
  const root = fileURLToPath(new URL('../../../web/src/', import.meta.url));
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const paths = new Set<string>(); const queries: Array<{ path: string; param: string }> = [];
  for (const f of walk(root).filter((x) => /(Client|client|resubscribe)\.ts$/.test(x) && !x.includes('.test.'))) {
    if (f.includes('/admin/')) continue; // the admin console has its own guard (admin-isolation.guard.test.ts)
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // code only, not comments
    for (const m of src.matchAll(/[`'](\/(?:[a-z][a-z0-9-]*|\$\{[^}]+\})(?:\/(?:[a-z][a-z0-9-]*|\$\{[^}]+\}))*)(\$\{[^}]*\?[^}]*\}|\?[a-zA-Z]+=)?/g)) {
      const raw = m[1]!.replace(/^\/api(?=\/)/, ''); // the service worker calls with the /api prefix
      if (/^\/(app|privacy|terms|request-access|admin)\b/.test(raw)) continue;
      const path = raw.replace(/\$\{[^}]+\}/g, ':p');
      if (path === ':p' || path.startsWith('/:p')) continue;
      paths.add(path);
      const q = /\?([a-zA-Z]+)=/.exec(m[0] + src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80));
      if (q) queries.push({ path, param: q[1]! });
    }
  }
  return { paths: [...paths].sort(), queries };
}

let server: Server; let base: string; let deps: TestDeps; let token: string;
let k: PersonIds; let o: PersonIds;
type Sweep = Map<string, string>; // concrete request → body ('' when the request did not succeed)
let before: Sweep; let after: Sweep;
const routes = discoveredRoutes().filter((r) => !r.endsWith('/') && !r.startsWith('/admin') && !r.startsWith('/ops') && !r.startsWith('/auth') && !r.startsWith('/billing/'));

function concrete(route: string): string[] {
  if (route.includes(':action')) return [];
  const ids = [k, o].flatMap((p) => Object.values(p));
  let out = [route];
  if (out[0]!.includes(':query')) out = FIND_QUERIES.map((q) => route.replace(':query', q));
  while (out.some((x) => x.includes(':id'))) out = out.flatMap((x) => (x.includes(':id') ? ids.map((id) => x.replace(':id', id)) : [x]));
  return out;
}
async function sweep(): Promise<Sweep> {
  const out: Sweep = new Map();
  const { queries } = webCalls();
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (const r of routes) {
    for (const p of concrete(r)) {
      const res = await fetch(`${base}${p}`, { headers: H });
      out.set(`GET ${r} ${p}`, res.status < 300 ? await res.text() : '');
      for (const q of queries.filter((x) => matchesRoute(r, x.path.replace(/:p/g, 'x')) || x.path === r)) {
        for (const id of [k, o].flatMap((x) => Object.values(x))) {
          const rq = await fetch(`${base}${p}?${q.param}=${id}`, { headers: H });
          out.set(`GET ${r} ${p}?${q.param}=${id}`, rq.status < 300 ? await rq.text() : '');
        }
      }
    }
  }
  for (const pr of POST_READS) for (const who of [k, o]) {
    const res = await fetch(`${base}${pr.route}`, { method: 'POST', headers: H, body: JSON.stringify(pr.body(who)) });
    out.set(`POST ${pr.route} ${who.clientId}`, res.status < 300 ? await res.text() : '');
  }
  return out;
}
const byRoute = (s: Sweep) => {
  const m = new Map<string, { restricted: boolean; control: boolean; ok: boolean }>();
  for (const [key, body] of s) {
    const route = key.split(' ')[1]!;
    const e = m.get(route) ?? { restricted: false, control: false, ok: false };
    e.restricted ||= body.includes(RESTRICTED); e.control ||= body.includes(CONTROL); e.ok ||= body.length > 0;
    m.set(route, e);
  }
  return m;
};

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'guard@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  token = s.token;
  k = await seedPerson(deps, s.user.id, { person: 'Khalid', marker: RESTRICTED, clientName: 'Marina Estates', base, token });
  o = await seedPerson(deps, s.user.id, { person: 'Omar', marker: CONTROL, clientName: 'Harbour Homes', base, token });
  // enough of a book to unlock the insights gated on it (Deals at risk): clients and notes with nobody's words
  for (let i = 0; i < 4; i++) {
    const f = await deps.clients.create(s.user.id, `Filler ${i}`);
    for (let n = 0; n < 4; n++) await deps.notes.create(s.user.id, { clientId: f.id, source: 'paste', rawText: 'met for coffee', audioKey: null, status: 'extracted' } as never);
  }
  await fetch(`${base}/scan`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  before = await sweep();
  await deps.erasureRequests.create(s.user.id, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * 86_400_000 });
  await fetch(`${base}/scan`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  after = await sweep();
  // diagnostics: ERASURE_LEAKS=1 prints what leaked; ERASURE_COVERAGE=1 prints the surface table
  if (process.env.ERASURE_LEAKS) for (const [key, body] of after) if (body.includes(RESTRICTED)) console.log('LEAK', key, body.slice(Math.max(0, body.indexOf(RESTRICTED) - 250), body.indexOf(RESTRICTED) + 80));
  if (process.env.ERASURE_COVERAGE) {
    const b = byRoute(before); const a = byRoute(after);
    for (const r of [...b.keys()].sort()) console.log(`COVERAGE\t${r}\t${b.get(r)!.restricted ? 'shows-restricted' : b.get(r)!.control ? 'GAP' : b.get(r)!.ok ? 'no-person-text' : 'not-a-GET'}\t${a.get(r)?.restricted ? 'LEAK' : 'withheld'}`);
  }
}, 120_000);
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] the erasure guard finds every surface by itself', () => {
  it('the sweep reaches the surfaces it must (sanity: the client page and Inventory suggestions show both people)', () => {
    const b = byRoute(before);
    for (const r of ['/clients/:id/overview', '/inventory/matches', '/today', '/ledger']) expect(b.get(r), r).toMatchObject({ restricted: true, control: true });
  });

  it('NEGATIVE: no fixture gap: every surface that shows person text shows the restricted person\'s too', () => {
    const gaps = [...byRoute(before)].filter(([, e]) => e.control && !e.restricted).map(([r]) => r);
    expect(gaps).toEqual([]);
  });

  it('NEGATIVE: every surface that shows no person text is listed with its reason, and the claim holds', () => {
    const b = byRoute(before);
    const unlisted = [...b].filter(([r, e]) => e.ok && !e.restricted && !e.control && !(r in NO_PERSON_TEXT)).map(([r]) => r);
    expect(unlisted).toEqual([]);
    const wrongClaims = Object.keys(NO_PERSON_TEXT).filter((r) => b.get(r)?.restricted || b.get(r)?.control);
    expect(wrongClaims).toEqual([]);
  });

  it('NEGATIVE: once the restriction opens, the restricted person\'s words appear on no surface', () => {
    const leaks = [...after].filter(([, body]) => body.includes(RESTRICTED)).map(([key]) => key);
    expect(leaks).toEqual([]);
  });

  it('nothing is over-withheld: the other person stays wherever they were', () => {
    // request by request, among those that succeeded both times (the Today refresh is rate-limited by the second sweep)
    const lost = [...before].filter(([key, body]) => body.includes(CONTROL) && (after.get(key) ?? '') !== '' && !after.get(key)!.includes(CONTROL)).map(([key]) => key);
    expect(lost).toEqual([]);
  });

  // [P48 · owner] was "the export keeps it": the export now withholds them like every other surface (pending the
  // lawyer's confirmation). The before sweep is what proves the export carried them.
  it('NEGATIVE: the export carried the restricted person before the restriction, and does not after it', () => {
    expect([...before].some(([key, body]) => key.includes('/account/export') && body.includes(RESTRICTED))).toBe(true);
    expect([...after].some(([key, body]) => key.includes('/account/export') && body.includes(RESTRICTED))).toBe(false);
  });

  it('NEGATIVE: every API path the web app calls is a discovered route (no renderer reads an unswept source)', () => {
    const all = discoveredRoutes();
    const unknown = webCalls().paths.filter((p) => !all.some((r) => matchesRoute(r, p.replace(/:p/g, 'x')) || r === p));
    expect(unknown).toEqual([]);
  });
});
