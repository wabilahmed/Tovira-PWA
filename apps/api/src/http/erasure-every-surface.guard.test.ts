import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P40-2] Guard: while a third-party erasure request is open, the restricted person's data appears on NO rep-facing
 * surface. One fixture — Khalid, a third party in Marina Estates' chat, whose words all carry the marker
 * "ZEBRAQUARTZ" (his messages, the promise, requirement, meeting, key date, people entry and pointer read from
 * them, and a held note the rep wrote about him) — is read through every surface, and none may show the marker.
 *
 * Every route the API serves is listed below: a READ surface is probed; anything else carries its reason. A NEW
 * route that isn't in this list fails the guard, so a new surface can't ship without being checked.
 * Exports are the one exception, by the existing rule: restricted data is withheld from every surface but stays in
 * the rep's own export (TASK 2, erasure-restriction.test.ts).
 */
const MARK = 'ZEBRAQUARTZ';
type Probe = { method: 'GET' | 'POST'; path: (ids: Ids) => string; body?: (ids: Ids) => unknown };
type Ids = { clientId: string; noteId: string; promiseId: string; captureId: string };
const GET = (path: (ids: Ids) => string): Probe => ({ method: 'GET', path });

/** Every route → a probe (a read surface) or the reason it is not one. */
export const SURFACES: Record<string, Probe | string> = {
  // the client page: header summary + every accordion + Conversations
  '/clients/:id/overview': GET((i) => `/clients/${i.clientId}/overview`),
  '/clients/:id/notes': GET((i) => `/clients/${i.clientId}/notes`),
  '/clients/:id/pointers': GET((i) => `/clients/${i.clientId}/pointers`),
  '/clients/:id/stakeholders': GET((i) => `/clients/${i.clientId}/stakeholders`),
  '/clients/:id/personal-facts': GET((i) => `/clients/${i.clientId}/personal-facts`),
  '/clients/:id/meetings': GET((i) => `/clients/${i.clientId}/meetings`),
  '/clients/:id/brief': GET((i) => `/clients/${i.clientId}/brief`),
  '/receipts/sources': { method: 'POST', path: () => '/receipts/sources', body: (i) => ({ refs: [{ noteId: i.noteId, clientId: i.clientId, span: `${MARK} here`, quote: `${MARK} here` }] }) },
  '/receipts/thread': { method: 'POST', path: () => '/receipts/thread', body: (i) => ({ ref: { noteId: i.noteId, clientId: i.clientId }, full: true }) },
  '/receipts/conversation': { method: 'POST', path: () => '/receipts/conversation', body: (i) => ({ noteId: i.noteId }) },
  // the Clients list
  '/clients': GET(() => '/clients'),
  '/clients/row-summaries': GET(() => '/clients/row-summaries'),
  '/clients/status-suggestions': GET(() => '/clients/status-suggestions'),
  // Today, Deals at risk, Needs your answer
  '/today': GET(() => '/today'),
  '/today/refresh': { method: 'POST', path: () => '/today/refresh' },
  '/hero/risk': GET(() => '/hero/risk'),
  '/hero/patterns': GET(() => '/hero/patterns'),
  '/hero/status': 'counts only (no content)',
  '/confirmations': GET(() => '/confirmations'),
  '/captures': GET(() => '/captures'),
  '/promises/kept-suggestions': GET(() => '/promises/kept-suggestions'),
  '/promises': GET(() => '/promises'),
  // Find
  '/find/:query': GET(() => '/find/missed-promises'),
  '/find/wanting/options': GET(() => '/find/wanting/options'),
  // Book Scan, the Monday Statement, notifications
  '/book-scan': GET(() => '/book-scan'),
  '/monday-digest': GET(() => '/monday-digest'),
  '/notifications': GET(() => '/notifications'),
  '/cold': GET(() => '/cold'),
  '/scan': { method: 'POST', path: () => '/scan' },
  '/meetings': GET(() => '/meetings'),
  '/inventory/matches': GET(() => '/inventory/matches'),
  '/inventory/by-client/:id': GET((i) => `/clients/${i.clientId}`.replace('/clients/', '/inventory/by-client/')),
  '/notes/pending': GET(() => '/notes/pending'),
  '/corpus-stats': GET(() => '/corpus-stats'),
  '/ledger': GET(() => '/ledger'),
  '/notes/:id/move-preview': GET((i) => `/notes/${i.noteId}/move-preview`),
  '/import/bulk/:id/status': 'an import batch: the rep\'s own upload in progress, not a stored client surface',
  // exports keep restricted data (existing rule)
  '/account/export': 'EXPORT — keeps restricted data by the existing rule (the rep\'s own copy)',
  // not read surfaces
  '/account': 'account deletion', '/me': 'the rep\'s own profile', '/me/timezone': 'write', '/me/ui-prefs': 'the rep\'s UI preferences',
  '/me/tour': 'tour progress', '/me/access-answers': 'the rep\'s own answers about their business, no client content', '/me/tour/complete': 'write', '/onboarding/status': 'counts only', '/allowance/status': 'usage numbers',
  '/share-card': 'the rep\'s referral card', '/access-request': 'public form', '/push/subscribe': 'write', '/push/test': 'a fixed test message', '/push/config': 'the VAPID public key only', '/push/status': 'whether this device is stored, a boolean',
  '/auth/accept-invite': 'auth', '/auth/forgot-password': 'auth', '/auth/invite': 'auth', '/auth/invite/resend': 'auth', '/auth/login': 'auth',
  '/auth/logout': 'auth', '/auth/resend-verification': 'auth', '/auth/reset-password': 'auth', '/auth/signup': 'auth', '/auth/verify-email': 'auth',
  '/billing/checkout': 'billing', '/billing/customer': 'billing', '/billing/portal': 'billing', '/billing/status': 'billing', '/billing/success': 'billing',
  '/billing/top-up': 'billing', '/billing/webhook': 'billing',
  '/clients/': 'prefix of the client routes', '/lead-status': 'write (status)', '/outcome': 'write (outcome)',
  '/clients/:id/images': 'write (photo upload, removed in P36)', '/images/:id': 'an image the rep uploaded',
  '/clients/:id/deal-value': 'write', '/ledger/entries/:id/deal-value': 'write', '/clients/:id/notes/import': 'write', '/clients/:id/notes/paste': 'write', '/clients/:id/notes/voice': 'write',
  '/notes/:id/audio': 'the rep\'s own recording', '/notes/:id/extract': 'write (queues extraction)', '/notes/:id/follow-up': 'model draft — refuses restricted notes (TASK 2)',
  '/notes/:id/move': 'write', '/notes/:id/transcribe': 'write', '/notes/:id/undo': 'write',
  '/promises/:id': 'write', '/promises/:id/confirm': 'write', '/promises/:id/done': 'write', '/promises/:id/restore': 'write',
  '/promises/kept-suggestions/:id/:action': 'write', '/captures/:id/confirm': 'write', '/captures/:id/reject': 'write',
  '/meetings/:id': 'write', '/meetings/:id/confirm': 'write', '/meetings/parse': 'parses the rep\'s own typed words',
  '/import/bulk': 'write', '/import/bulk/:id': 'write', '/import/bulk/files': 'write', '/import/bulk/parse': 'the rep\'s own upload, before import',
  '/inventory': 'the rep\'s own listings', '/inventory/': 'prefix', '/inventory/:id': 'a listing', '/inventory/:id/matches': 'matches for a listing — probed via /inventory/matches',
  '/inventory/:id/shares': 'share history (client ids + outcomes)', '/inventory/matches/:id/dismiss': 'write', '/inventory/matches/:id/share': 'write',
  '/inventory/matches/seen': 'write', '/inventory/shares/:id': 'write',
  // [P45] the admin console: operator-only, its own session; can never read rep data (admin-isolation.guard.test.ts)
  '/admin/': 'admin console (operator)', '/admin/audit': 'admin console', '/admin/access-requests': 'admin console (beta requests, no rep data)', '/admin/access-requests/:id/:action': 'admin console', '/admin/costs': 'admin console (cost figures, no message text)', '/admin/leads': 'admin console (prospects, not rep data)', '/admin/leads/:id(/invite)?': 'admin console', '/admin/auth/enrol/confirm': 'admin sign-in', '/admin/auth/enrol/start': 'admin sign-in',
  '/admin/auth/login': 'admin sign-in', '/admin/auth/logout': 'admin sign-in', '/admin/auth/me': 'admin sign-in', '/admin/auth/mfa': 'admin sign-in', '/admin/auth/set-password': 'admin sign-in',
  '/ops/': 'ops (operator, token-gated)', '/ops/costs': 'ops — cost figures per account, no message text', '/ops/access-requests': 'ops', '/ops/access-requests/:id(/approve|/reject|/reinvite)?': 'ops', '/ops/ai-pause': 'ops',
  '/ops/erasure/': 'ops', '/ops/erasure/complete': 'ops', '/ops/erasure/open': 'ops', '/ops/erasure/preview': 'ops — the operator reviewing the request itself',
  '/ops/erasure/reject': 'ops', '/ops/erasure/withdraw': 'ops', '/ops/spend': 'ops', '/ops/spend-cap/audit': 'ops', '/ops/spend-cap/override': 'ops',
  '/ops/spend/by-class': 'ops', '/ops/spend/conversation': 'ops', '/ops/tour-funnel': 'ops',
};

/** The routes the API serves, read from the route files (string paths and /^\/…$/ patterns). */
function discoveredRoutes(): string[] {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.') && n !== 'test-deps.ts')) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\/\^((?:\\\/[^\s$]*?))\$\//g)) {
      out.add(m[1]!.replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':id').replace(/\(\[a-z-\]\+\)/g, ':query').replace(/\((?:[a-z|-]+)\)/g, ':action'));
    }
    for (const line of src.split('\n')) if (/path|GET_PATHS|PATHS|url/.test(line)) for (const m of line.matchAll(/'(\/[a-z][a-z0-9/-]*)'/g)) out.add(m[1]!);
  }
  return [...out].sort();
}

let server: Server;
let base: string;
let deps: TestDeps;
let token: string;
let ids: Ids;
const DAY = 86_400_000;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  token = s.token;
  const u = s.user.id;
  const c = await deps.clients.create(u, 'Marina Estates');
  (c as { lastTouchedAt: number }).lastTouchedAt = Date.now() - 45 * DAY; // gone quiet → Today, Find, risk
  const K1 = `${MARK} here, looking for a 4BR villa in Mirdif, budget around 3M`;
  const K2 = `${MARK} will send the passport copy by 01/02/2026`;
  const note = await deps.notes.create(u, {
    clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: `Khalid: ${K1}\nKhalid: ${K2}\nOmar: hello\nRep: noted`,
    messages: [
      { sentAt: '2026-01-01T10:00', sender: 'Khalid', body: K1, media: false, role: 'client' },
      { sentAt: '2026-01-02T10:00', sender: 'Khalid', body: K2, media: false, role: 'client' },
      { sentAt: '2026-01-03T10:00', sender: 'Omar', body: 'hello', media: false, role: 'client' },
      { sentAt: '2026-01-03T10:05', sender: 'Rep', body: 'noted', media: false, role: 'rep' },
    ],
  } as never);
  await deps.notes.update(u, note.id, { extracted: {
    summary: 'Khalid wants a villa.', promises: [], requirements: [], // a mention: kept by the existing rule
    people: [{ name: 'Khalid', role: `${MARK} buyer`, reports_to: null, decision_role: 'decision_maker', notes: MARK }, { name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
    personal_facts: [{ subject: 'Khalid', fact: `${MARK} collects watches`, category: 'background', source_span: K1, source_message_at: '2026-01-01T10:00' }],
    key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [{ sender: 'Khalid', question: `${MARK} can you send the floor plan?` }],
  } as never, embedding: [1, 0, 0] });
  await deps.facts.saveExtraction(u, { noteId: note.id, clientId: c.id, promises: [
    { text: `Send the ${MARK} passport copy`, owner: 'client', due_date: '2026-02-01', due_raw: '01/02/2026', confidence: 'high', source_span: K2, source_message_at: '2026-01-02T10:00' },
  ], keyDates: [{ description: `${MARK} lease ends`, date: '2026-12-01', date_raw: '01/12/2026', type: 'deadline', source_span: K2, source_message_at: '2026-01-02T10:00' }] });
  await deps.requirements.saveForNote(u, note.id, c.id, [{ text: '4BR villa in Mirdif', requirementRaw: K1, statedOn: '2026-01-01', confidence: 'high', embedding: null }]);
  await deps.meetings.create(u, { clientId: c.id, datetime: '2026-02-10T11:00:00.000Z', datetimeRaw: `${MARK} viewing`, title: null, confirmed: true, noteId: note.id, sourceSpan: K1, sourceMessageAt: '2026-01-01T10:00', captureAt: '2026-01-03' });
  await deps.clientPointers!.save(u, c.id, { pointers: [{ section: 'relationship', text: `Khalid (${MARK}) pushes on price`, receipts: [] }], retrospectiveDisclosure: null }, Date.now());
  const held = await deps.askCapture!.capture(u, c.id, 'Khalid raised his budget to 3.2M', '2026-01-04'); // a mention
  const [p] = await deps.facts.listPromisesByUser(u);
  ids = { clientId: c.id, noteId: note.id, promiseId: p!.id, captureId: held!.noteId };
  // an alert written BEFORE the window opens quotes him; the scan then runs again inside the window
  await deps.notifications.createIfAbsent(u, { type: 'overdue_promise', dedupeKey: 'pre-window', clientId: c.id, title: 'Overdue', body: `Khalid: ${MARK} passport copy` });
  await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
  await fetch(`${base}/scan`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const call = async (p: Probe): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${base}${p.path(ids)}`, { method: p.method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(p.body ? { body: JSON.stringify(p.body(ids)) } : {}) });
  return { status: res.status, text: await res.text() };
};

describe('[P40-2] the erasure restriction holds on every surface', () => {
  it('every route the API serves is in the list (a new surface must be added, or this fails)', () => {
    expect(discoveredRoutes().filter((r) => !(r in SURFACES))).toEqual([]);
  });

  for (const [route, probe] of Object.entries(SURFACES)) {
    if (typeof probe === 'string') continue;
    it(`${route} never shows the restricted person's data`, async () => {
      const { status, text } = await call(probe);
      expect(status, `${route} → ${status}`).toBeLessThan(500);
      expect(text, `${route} leaked the restricted person's data`).not.toContain(MARK);
    });
  }

  it('the export keeps it (the existing rule) — so the fixture really carries the data', async () => {
    const { text } = await call(GET(() => '/account/export'));
    expect(text).toContain(MARK);
  });
});
