import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { discoveredRoutes } from '../test-support/route-discovery.js';
import { seedPerson, type PersonIds } from '../test-support/erasure-fixture.js';
import { FIND_QUERIES } from '../services/find/find-service.js';

// [P49-4] Owner: after a rename every surface shows the new name right away and nothing cached keeps the old one: the
// client page, the Clients list, Today (including its precomputed list), Find, Promises, the Ledger, the brief, the Monday
// Statement, notifications and the export. Every GET route the API serves is fetched before and after the rename: a
// response that showed the old name must show the new one, and the old name may survive only where it is the client's
// record of what they were called (the export's previous names and rename history).
const OLD = 'Khalid Dubai Marina';
const NEW = 'Abdullah Al Mansoori';
const DAY = 86_400_000;

let server: Server; let base: string; let deps: TestDeps; let token: string; let u: string;
let k: PersonIds;
type Sweep = Map<string, string>;
let before: Sweep; let after: Sweep;
const routes = discoveredRoutes().filter((r) => !r.endsWith('/') && !r.startsWith('/admin') && !r.startsWith('/ops') && !r.startsWith('/auth') && !r.startsWith('/billing/'));
const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

function concrete(route: string): string[] {
  if (route.includes(':action')) return [];
  let out = [route];
  if (route.includes(':query')) out = FIND_QUERIES.map((q) => route.replace(':query', q));
  while (out.some((x) => x.includes(':id'))) out = out.flatMap((x) => (x.includes(':id') ? Object.values(k).map((id) => x.replace(':id', id)) : [x]));
  return out;
}
async function sweep(): Promise<Sweep> {
  const out: Sweep = new Map();
  for (const r of routes) for (const p of concrete(r)) {
    const res = await fetch(`${base}${p}`, { headers: H() });
    out.set(`${r} ${p}`, res.status < 300 ? await res.text() : '');
  }
  return out;
}

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rename@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  token = s.token; u = s.user.id;
  k = await seedPerson(deps, u, { person: 'Khalid', marker: 'ZEBRAQUARTZ', clientName: OLD, base, token });
  // the client folded into a chat's people under their name at the time (what extraction stores)
  const n = await deps.notes.create(u, { clientId: k.clientId, source: 'paste', rawText: 'met at the site office', audioKey: null, status: 'extracted' } as never);
  await deps.notes.update(u, n.id, { extracted: { summary: 'Met at the site office.', promises: [], people: [{ name: OLD, role: 'buyer', reports_to: null, decision_role: 'decision_maker', notes: null }], personal_facts: [{ subject: OLD, fact: 'prefers mornings', category: 'background', source_span: null, source_message_at: null }], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [], requirements: [] } as never });
  // a chat on another client that names him: the move suggestion stores his name
  const other = await deps.clients.create(u, 'Harbour Homes');
  const misfiled = await deps.notes.create(u, { clientId: other.id, source: 'paste', rawText: 'a note', audioKey: null, status: 'extracted' } as never);
  await deps.notes.update(u, misfiled.id, { moveSuggestion: { toClientId: k.clientId, toClientName: OLD, mentioned: ['Khalid'], reason: `This note mentions Khalid, who are on ${OLD}'s record. Move it?`, createdAt: Date.now() } });
  // an alert and Today's precomputed list, both written while he had the old name
  await deps.clients.setLastTouched(u, k.clientId, Date.now() - 40 * DAY);
  await fetch(`${base}/scan`, { method: 'POST', headers: H() });
  before = await sweep();
  const res = await fetch(`${base}/clients/${k.clientId}/name`, { method: 'POST', headers: H(), body: JSON.stringify({ name: NEW }) });
  if (res.status !== 200) throw new Error(`rename failed: ${res.status} ${await res.text()}`);
  after = await sweep();
  if (process.env.RENAME_DEBUG) for (const [key, b] of after) { const x = withoutNameRecord(key, b); const i = x.indexOf(OLD); if (i >= 0) console.log('STALE', key.split(' ')[0], x.slice(Math.max(0, i - 120), i + 40)); }
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

/** What may still carry the old name after the rename, and why: the export's record of what the client was called (their
 *  previous names and rename history), the Clients list's search aliases (searching the old name still finds them), and
 *  two strings the fixture itself writes that are not a copy of this client's name: the rep-typed title of an inventory
 *  items, and the name of a different client ("… (second account)"). Everything else must not. */
function withoutNameRecord(key: string, body: string): string {
  if (!body) return body;
  let out = body;
  if (key.startsWith('/account/export ')) {
    const data = JSON.parse(body) as Record<string, unknown>;
    delete data.contactAliases; delete data.clientNameHistory;
    out = JSON.stringify(data);
  }
  if (key.startsWith('/clients/row-summaries ')) {
    const data = JSON.parse(body) as { rows: Record<string, { aliases?: string[] }> };
    for (const r of Object.values(data.rows)) delete r.aliases;
    out = JSON.stringify(data);
  }
  return out.split(`${OLD} (second account)`).join('another client').split(`Townhouse list for ${OLD}`).join('a rep-typed title').split(`Villa list for ${OLD}`).join('a rep-typed title');
}

describe('[P49-4] a rename shows on every surface at once', () => {
  it('the fixture reaches the surfaces the owner named, under the old name', () => {
    const showing = new Set([...before].filter(([, b]) => b.includes(OLD)).map(([key]) => key.split(' ')[0]!));
    for (const r of ['/clients', '/clients/:id', '/today', '/find/:query', '/promises', '/ledger', '/clients/:id/brief', '/monday-digest', '/notifications', '/account/export', '/confirmations'])
      expect(showing, `${r} never showed the client's name, so this test cannot see it`).toContain(r);
  });

  it('NEGATIVE: every response that showed the old name now shows the new one, and the old name nowhere', () => {
    const stale: string[] = []; const missing: string[] = [];
    for (const [key, b] of before) {
      if (!withoutNameRecord(key, b).includes(OLD)) continue; // showed only a string that is not a copy of his name
      const a = after.get(key) ?? '';
      if (withoutNameRecord(key, a).includes(OLD)) stale.push(key);
      if (!a.includes(NEW)) missing.push(key);
    }
    expect(stale).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('the export keeps the old name only as the client\'s previous name and in the rename history', () => {
    const data = JSON.parse([...after].find(([key]) => key.startsWith('/account/export '))![1]) as { contactAliases: Array<{ alias: string }>; clientNameHistory: Array<{ oldName: string; newName: string }> };
    expect(data.contactAliases.map((a) => a.alias)).toContain(OLD);
    expect(data.clientNameHistory).toEqual([expect.objectContaining({ oldName: OLD, newName: NEW })]);
  });

  it('NEGATIVE: a receipt still quotes what was said, verbatim: stored messages are never rewritten', async () => {
    const notes = await deps.notes.listByClient(u, k.clientId);
    const all = JSON.stringify(notes.map((x) => x.messages));
    expect(all).toContain('ZEBRAQUARTZ here, looking for a 4BR villa'); // his words, as he wrote them
    expect(all).toContain('"sender":"Khalid"'); // under the label WhatsApp gave them
  });
});
