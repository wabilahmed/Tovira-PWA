import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P45-1 · owner] GUARD: an admin can read only admin data (leads, access requests, the cost report) and NEVER a
 * rep's clients, notes, facts, receipts or conversations, through any route. Every route the API serves is
 * discovered from the route files (as the erasure guard does) and called with a fully signed-in admin session,
 * both as the admin cookie and as a Bearer token. No response may contain the rep's data, and every rep-data route
 * must refuse (401). A new route is covered automatically.
 */
const MARK = 'ZEBRAQUARTZ';
let server: Server; let base: string; let deps: TestDeps;
let ids: { clientId: string; noteId: string; promiseId: string };
let admin: { cookie: string; token: string };

function discoveredRoutes(): string[] {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.') && n !== 'test-deps.ts')) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\/\^((?:\\\/[^\s$]*?))\$\//g)) out.add(m[1]!.replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':id').replace(/\(\[a-z-\]\+\)/g, 'missed-promises').replace(/\((?:[a-z|-]+)\)/g, ''));
    for (const line of src.split('\n')) if (/path|GET_PATHS|PATHS|url/.test(line)) for (const m of line.matchAll(/'(\/[a-z][a-z0-9/-]*)'/g)) out.add(m[1]!);
  }
  return [...out].filter((r) => !r.startsWith('/admin') && !r.startsWith('/ops')).sort();
}
// Public by design (no session at all) — they still must not show rep data.
const PUBLIC = /^\/(version|health|healthz|legal|auth|access-request|billing\/webhook|invite|tour\/funnel)/;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep-zebraquartz@example.com', password: 'password123' }) })).json()) as { user: { id: string } };
  const u = s.user.id;
  const c = await deps.clients.create(u, `${MARK} Holdings`);
  const n = await deps.notes.create(u, { clientId: c.id, source: 'paste', rawText: `${MARK} said the budget is 3M` } as never);
  await deps.facts.saveExtraction(u, { noteId: n.id, clientId: c.id, promises: [{ text: `send ${MARK} the plan`, owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: `${MARK} said`, source_message_at: null }] });
  const p = (await deps.facts.listPromisesByUser(u))[0]!;
  ids = { clientId: c.id, noteId: n.id, promiseId: p.id };
  admin = await signInAdmin(base, deps);
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P45-1] an admin session never reads rep data', () => {
  const fill = (r: string) => r.replace(/:id/g, () => ids.clientId).replace(/\/notes\/:noteId/g, `/notes/${ids.noteId}`);

  it('every route, called with the admin cookie or the admin token as Bearer, returns no rep data; rep routes refuse', async () => {
    const leaks: string[] = [];
    const notRefused: string[] = [];
    const routes = discoveredRoutes();
    expect(routes.length).toBeGreaterThan(40);
    for (const route of routes) {
      const path = fill(route);
      for (const auth of [{ cookie: admin.cookie }, { authorization: `Bearer ${admin.token}` }] as Array<Record<string, string>>) {
        for (const method of ['GET', 'POST'] as const) {
          const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...auth }, ...(method === 'POST' ? { body: JSON.stringify({ noteId: ids.noteId, clientId: ids.clientId, refs: [{ noteId: ids.noteId, clientId: ids.clientId }] }) } : {}) });
          const text = await res.text();
          if (text.includes(MARK) || text.toLowerCase().includes('zebraquartz')) leaks.push(`${method} ${path} (${Object.keys(auth)[0]})`);
          if (!PUBLIC.test(route) && res.status >= 200 && res.status < 300) notRefused.push(`${method} ${path} → ${res.status}`);
        }
      }
    }
    expect(leaks, 'rep data returned to an admin session').toEqual([]);
    expect(notRefused, 'rep routes must refuse an admin session (401)').toEqual([]);
  });

  it('the same rep routes DO return the data to the rep (the probe is real)', async () => {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep-zebraquartz@example.com', password: 'password123' }) });
    const { token } = (await login.json()) as { token: string };
    expect(await (await fetch(`${base}/clients`, { headers: { authorization: `Bearer ${token}` } })).text()).toContain(MARK);
  });
});
