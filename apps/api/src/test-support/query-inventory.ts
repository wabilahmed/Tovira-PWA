/**
 * [P86 · index audit] Every SQL string the API passes to `.query(...)`, read from the source with the TypeScript
 * compiler: where it is (file, line, enclosing function), whether its text is built at runtime, and whether it runs
 * inside a tenant transaction (withTenant: as tovira_app with RLS) or on a pool directly (the owner, no RLS).
 * Used by db/query-plans.guard.test.ts to EXPLAIN every query, so a new query is checked the day it is written.
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface FoundQuery {
  file: string;
  line: number;
  fn: string;
  /** The SQL, with any runtime-built part left as a marker; null when it cannot be read statically. */
  sql: string | null;
  dynamic: boolean;
  tenant: boolean;
}

export const DYNAMIC_MARK = '/*${';

function strOf(e: ts.Expression, sf: ts.SourceFile, consts: Map<string, ts.Expression>, depth = 0): { text: string | null; dynamic: boolean } {
  if (depth > 8) return { text: null, dynamic: true };
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { text: e.text, dynamic: false };
  if (ts.isParenthesizedExpression(e)) return strOf(e.expression, sf, consts, depth + 1);
  if (ts.isIdentifier(e) && consts.has(e.text)) return strOf(consts.get(e.text)!, sf, consts, depth + 1);
  if (ts.isTemplateExpression(e)) {
    let text = e.head.text;
    let dynamic = false;
    for (const span of e.templateSpans) {
      const inner = ts.isIdentifier(span.expression) && consts.has(span.expression.text) ? strOf(consts.get(span.expression.text)!, sf, consts, depth + 1) : null;
      if (inner && inner.text !== null) { text += inner.text; dynamic ||= inner.dynamic; }
      else { text += `${DYNAMIC_MARK}${span.expression.getText(sf).slice(0, 60)}}*/`; dynamic = true; }
      text += span.literal.text;
    }
    return { text, dynamic };
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = strOf(e.left, sf, consts, depth + 1);
    const b = strOf(e.right, sf, consts, depth + 1);
    return { text: a.text !== null && b.text !== null ? a.text + b.text : null, dynamic: a.dynamic || b.dynamic };
  }
  return { text: null, dynamic: true };
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The app's queries: adapters, services, routes and the server. Owner-run scripts, the seed, the migration runner
 *  and eval tooling are not part of the running app and are left out. */
export function appQueries(srcDir: string): FoundQuery[] {
  const out: FoundQuery[] = [];
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file);
    if (/^(scripts|seed|db|eval|test-support)\//.test(rel) || rel === 'index.ts' || rel.includes('in-memory')) continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.query(')) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const consts = new Map<string, ts.Expression>();
    (function collect(n: ts.Node) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer);
      ts.forEachChild(n, collect);
    })(sf);
    (function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'query' && n.arguments.length > 0) {
        const r = strOf(n.arguments[0]!, sf, consts);
        let fn = '?';
        let inTenant = false;
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'withTenant') inTenant = true;
          if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name && fn === '?') fn = p.name.getText(sf);
          if (ts.isClassDeclaration(p) && p.name) fn = `${p.name.text}.${fn}`;
        }
        const receiver = n.expression.expression.getText(sf);
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          fn,
          sql: r.text,
          dynamic: r.dynamic,
          tenant: inTenant || (src.includes('withTenant') && !/pool$/i.test(receiver)),
        });
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return out;
}
