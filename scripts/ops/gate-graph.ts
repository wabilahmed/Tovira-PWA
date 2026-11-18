/**
 * [P75 · owner] Which files the extraction gate actually scores, so a push that changes none of them carries its
 * ancestor's verdict forward instead of spending a gate run.
 *
 * The gate runs if any changed path is:
 *  - in the gate's RUNTIME import graph, worked out from the source on every CI run (type-only imports are ignored:
 *    `import type`, `export type … from`, and imports whose every name is `type`). The roots are every non-test file in
 *    apps/api/src/eval/ and the model client the gate builds (adapters/model/, the spend wrapper in
 *    adapters/spend/gated-ai-clients.ts). container.ts is not followed: it is on the fixed list, and it imports the
 *    whole app (routes, billing, WhatsApp…), none of which the gate scores;
 *  - on the fixed list: adapters/model/, container.ts, config.ts, all of eval/ (code, fixtures, data), package.json,
 *    package-lock.json, apps/api/package.json, docker/api.prod.Dockerfile;
 *  - a prompt-version change (the version lives in services/extraction/prompt.ts, in the graph) or a model change
 *    (config.ts, fixed; or a MODEL/ANTHROPIC/BEDROCK/EXTRACT_ setting in infra/terraform/ecs.tf).
 * Fail closed: an import that resolves to nothing, a file that can't be read, or no eval/ folder throws, and the
 * caller runs the gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const SRC = 'apps/api/src';
export const GATE_FIXED_PREFIXES = [`${SRC}/adapters/model/`, `${SRC}/eval/`];
export const GATE_FIXED_FILES = [`${SRC}/container.ts`, `${SRC}/config.ts`, 'package.json', 'package-lock.json', 'apps/api/package.json', 'docker/api.prod.Dockerfile'];
/** Not followed: on the fixed list, and it wires the whole app. */
const NOT_FOLLOWED = new Set([`${SRC}/container.ts`]);
const EXTRA_ROOTS = [`${SRC}/adapters/spend/gated-ai-clients.ts`];
export const ECS_TF = 'infra/terraform/ecs.tf';

const isTest = (p: string): boolean => /\.(test|spec)\.tsx?$/.test(p) || p.includes('/test-support/');

function listTs(abs: string): string[] {
  return readdirSync(abs).flatMap((f) => {
    const p = join(abs, f);
    return statSync(p).isDirectory() ? listTs(p) : /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) ? [p] : [];
  });
}

/** The relative module specifiers a file needs at runtime. */
export function runtimeImports(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const spec = (n: ts.Expression | undefined): string | null => (n && ts.isStringLiteral(n) ? n.text : null);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      const s = spec(n.moduleSpecifier);
      if (s && !typeOnly) out.push(s);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const typeOnly = n.isTypeOnly || (!!n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.length > 0 && n.exportClause.elements.every((e) => e.isTypeOnly));
      const s = spec(n.moduleSpecifier);
      if (s && !typeOnly) out.push(s);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const s = spec(n.arguments[0]);
      if (s) out.push(s);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.filter((s) => s.startsWith('.'));
}

function resolveSpec(fromAbs: string, s: string): string {
  const base = resolve(dirname(fromAbs), s);
  const stem = base.replace(/\.(js|mjs|cjs|ts|tsx)$/, '');
  for (const c of [`${stem}.ts`, `${stem}.tsx`, join(stem, 'index.ts')]) if (existsSync(c)) return c;
  if (existsSync(base) && statSync(base).isFile()) return base; // e.g. a JSON import
  throw new Error(`import graph: '${s}' from ${fromAbs} resolves to nothing`);
}

/** Repo-relative paths of every file the gate's code needs at runtime. Throws when the graph can't be read. */
export function gateImportGraph(repoRoot: string): Set<string> {
  const rel = (abs: string): string => relative(repoRoot, abs).split(sep).join('/');
  const evalDir = join(repoRoot, SRC, 'eval');
  if (!existsSync(evalDir)) throw new Error('import graph: no apps/api/src/eval');
  const roots = listTs(evalDir);
  const modelDir = join(repoRoot, SRC, 'adapters/model');
  if (existsSync(modelDir)) roots.push(...listTs(modelDir));
  for (const r of EXTRA_ROOTS) if (existsSync(join(repoRoot, r))) roots.push(join(repoRoot, r));
  const seen = new Set<string>();
  const stack = roots.filter((r) => !isTest(rel(r)));
  while (stack.length > 0) {
    const abs = stack.pop()!;
    const r = rel(abs);
    if (seen.has(r)) continue;
    seen.add(r);
    if (NOT_FOLLOWED.has(r) || !/\.tsx?$/.test(abs)) continue;
    for (const s of runtimeImports(readFileSync(abs, 'utf8'), abs)) {
      const target = resolveSpec(abs, s);
      if (!isTest(rel(target))) stack.push(target);
    }
  }
  for (const r of NOT_FOLLOWED) seen.delete(r); // forced by the fixed list, not by the graph
  return seen;
}

/** Does a change to `path` need the gate? */
export function forcesGate(path: string, graph: Set<string>): boolean {
  return graph.has(path) || GATE_FIXED_FILES.includes(path) || GATE_FIXED_PREFIXES.some((p) => path.startsWith(p));
}

/** A model setting changed in ecs.tf (the added or removed lines of its diff). */
export function modelSettingChanged(diff: string): boolean {
  return diff.split('\n').some((l) => /^[+-](?![+-])/.test(l) && /\b(MODEL\w*|ANTHROPIC\w*|BEDROCK\w*|EXTRACT_\w*)\b/.test(l));
}
