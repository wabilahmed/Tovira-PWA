import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** [P40-2 → P47] The routes the API serves, read from the route files (string paths and /^\/…$/ patterns). */
export function discoveredRoutes(): string[] {
  const dir = fileURLToPath(new URL('../http/', import.meta.url));
  const out = new Set<string>();
  const files = readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.') && n !== 'test-deps.ts').map((n) => join(dir, n));
  files.push(fileURLToPath(new URL('../server.ts', import.meta.url))); // [P47] /version, /health and friends live here
  for (const file of files) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // [P47] routes matched by prefix + suffix: path.startsWith('/clients/') && path.endsWith('/outcome') → /clients/:id/outcome;
    // path.startsWith('/clients/') && !…includes('/') → /clients/:id
    for (const m of src.matchAll(/startsWith\('(\/[a-z-]+\/)'\)\s*&&\s*path\.endsWith\('(\/[a-z-]+)'\)/g)) out.add(`${m[1]}:id${m[2]}`);
    for (const m of src.matchAll(/startsWith\('(\/[a-z-]+\/)'\)\s*&&\s*!path\.slice\([^)]*\)\.includes\('\/'\)/g)) out.add(`${m[1]}:id`);
    if (/method === 'GET' && path\.startsWith\('\/clients\/'\)/.test(src)) out.add('/clients/:id');
    for (const m of src.matchAll(/\/\^((?:\\\/[^\s$]*?))\$\//g)) {
      out.add(m[1]!.replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':id').replace(/\(\[a-z-\]\+\)/g, ':query').replace(/\((?:[a-z|-]+)\)/g, ':action'));
    }
    for (const line of src.split('\n')) if (/path|GET_PATHS|PATHS|url/.test(line)) for (const m of line.matchAll(/'(\/[a-z][a-z0-9/-]*)'/g)) out.add(m[1]!);
  }
  return [...out].sort();
}

/** Does a concrete path (no query) match a discovered route pattern? */
export function matchesRoute(route: string, path: string): boolean {
  const re = new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '(' || c === ')' || c === '?' || c === '|' ? c : `\\${c}`)).replace(/:id|:query|:action/g, '[^/]+')}$`);
  return re.test(path);
}
