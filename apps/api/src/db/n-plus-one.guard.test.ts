import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * [P86 · index audit, owner 24 Nov] No N+1 loops. The audit found the app reading one client (or one row) at a time
 * inside a loop: the client list, Today, Find, Book Scan, recall, Monday, the scan, the export and the notes sweep
 * each opened a tenant transaction per client or per rep (100 clients = 400 round trips; the sweep ~1,600 a tick).
 * They now read once (listForClients / clientsById / one query). This guard keeps it that way, statically:
 *   A. a Postgres adapter never runs `.query(` inside a loop;
 *   B. a service or route never awaits a repository READ (list / find / get / search) inside a loop.
 * The few loops that remain are listed below with the reason each is bounded; an entry that no longer matches any
 * loop fails too, so the list stays true.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

const ALLOWED: Record<string, string> = {
  // A. adapters
  'adapters/admin/pg-admin-store.ts#replaceRecoveryCodes': 'ten recovery codes, once per admin enrolment',
  'adapters/leads/pg-hot-leads-store.ts#saveBatch': 'operator-plane sync every 10 minutes, one page of leads from Explee; each lead checks its own tombstone',
  'adapters/spend/pg-ai-allowance-repository.ts#expireStale': 'one update per expired reservation (a handful a minute at most), inside one cross-tenant pass',
  'adapters/visits/pg-visit-store.ts#rollupBefore': 'one transaction per closed day, so a day rolls up or not at all (usually one day)',
  // B. services and routes
  'services/notes/list-for-clients.ts#listForClients': 'the fallback for a repository with no batched read (a minimal test fake); real repositories answer in one read',
  'services/notes/list-for-clients.ts#clientsById': 'the fallback for a repository with no listByUser (a minimal test fake)',
  'services/import/bulk-import-service.ts#importConfirmed': 'one read per chat in the batch the rep just imported, once when the batch finishes',
  'http/bulk-import-routes.ts#handleBulkImportRoute': 'only when a batch has gone stale (a crashed worker): heals each unfinished chat once',
  'http/admin-free-access-routes.ts#adminFreeAccessRoute': 'operator page: one row per free-access grant (a handful)',
  // Held, not bounded: these two sit in the extraction gate's import graph, and the owner asked that this change spend
  // no AI money (24 Nov). Rewrite them with listForClients alongside the next change that runs the gate anyway.
  'services/extraction/extraction-service.ts#detectAndStoreMisfile': 'HELD (gate graph): one notes read per other client after each extraction',
  'services/recall/structured-recall.ts#forUser': 'HELD (gate graph): one notes read per in-scope client per structured recall',
  'services/media/audio-retention-service.ts#sweep': 'nightly retention: per rep, then one update per expired recording',
};

const LOOP_CALLBACKS = new Set(['map', 'forEach', 'flatMap', 'filter', 'reduce', 'some', 'every']);
const REPO_RECEIVER = /(repo|repos|repository|store|notes|clients|facts|promises|requirements|meetings|matches|inventory|images|aliases|alerts|notifications|users|subscriptions|sessions|recall|ledger|pointers|corrections|glossary|billing)\b/i;
const READ = /^(list|find|get|search)/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!['scripts', 'seed', 'eval', 'test-support'].includes(f)) out.push(...files(p)); }
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The loop a call repeats in, if any. A call that builds a for-of's iterable runs once; a call inside a closure that
 *  is only defined in a loop (not a .map/.forEach callback) runs when the closure is called, so neither counts. */
function loopOf(n: ts.Node): ts.Node | null {
  let child: ts.Node = n;
  for (let p: ts.Node | undefined = n.parent; p; child = p, p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return null;
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && child === p.expression) continue;
    if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return p;
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const call = p.parent;
      if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && LOOP_CALLBACKS.has(call.expression.name.text)) return p;
      return null;
    }
  }
  return null;
}
function fnName(n: ts.Node, sf: ts.SourceFile): string {
  let name = '?';
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) return p.name.getText(sf);
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && name === '?') name = p.name.text;
  }
  return name;
}

function findLoops(): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const file of files(SRC)) {
    const rel = relative(SRC, file);
    if (rel.includes('in-memory') || rel === 'http/test-deps.ts') continue;
    const isPgAdapter = rel.startsWith('adapters/') && /\/pg[-.]/.test('/' + rel.split('/').pop());
    const isService = rel.startsWith('services/') || rel.startsWith('http/') || rel === 'server.ts';
    if (!isPgAdapter && !isService) continue;
    const src = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    (function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const receiver = n.expression.expression.getText(sf);
        const flagged = isPgAdapter
          ? method === 'query' && !/^\s*['"`](BEGIN|COMMIT|ROLLBACK)/.test(n.arguments[0]?.getText(sf) ?? '')
          : READ.test(method) && REPO_RECEIVER.test(receiver) && ts.isAwaitExpression(n.parent);
        if (flagged && loopOf(n)) {
          const key = `${rel}#${fnName(n, sf)}`;
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          hits.set(key, [...(hits.get(key) ?? []), `${rel}:${line} ${receiver}.${method}`]);
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return hits;
}

describe('[P86] no N+1 loops (static)', () => {
  const hits = findLoops();

  it('no Postgres adapter queries, and no service reads a repository, once per row inside a loop', () => {
    const unexplained = [...hits].filter(([key]) => !(key in ALLOWED)).flatMap(([, where]) => where);
    expect(unexplained, 'read these in one query (see services/notes/list-for-clients.ts), or add the loop to ALLOWED with why it is bounded').toEqual([]);
  });

  it('every allowed loop still exists (the list stays true)', () => {
    const stale = Object.keys(ALLOWED).filter((key) => !hits.has(key));
    expect(stale).toEqual([]);
  });
});
