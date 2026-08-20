import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// [SITE-MERGE] Code-split guard (the JS budget). A stranger on the landing page
// must download the tiny marketing entry, NOT the React app. We walk the entry's
// import graph and assert it stays inside src/marketing and never reaches app
// code (App, clients, notes, billing, auth, …) or React. Static — no build
// needed; a stray `import` of app code fails here immediately.
const MARKETING_DIR = resolve(process.cwd(), 'apps/web/src/marketing');
const BANNED =
  /from\s+['"](?:.*\/(?:App|clients|notes|billing|auth|hero|recall|meetings|monday|ledger|gallery|cards|capture)\b|react|react-dom)['"]?/;

/** Follow relative imports from an entry file (resolving `.js` → `.ts`). */
function graph(entry: string, seen = new Set<string>()): Set<string> {
  const abs = resolve(entry);
  if (seen.has(abs)) return seen;
  seen.add(abs);
  const src = readFileSync(abs, 'utf8');
  // Match both `import x from './y'` and side-effect `import './y'`.
  for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
    graph(resolve(dirname(abs), m[1]!.replace(/\.js$/, '.ts')), seen);
  }
  return seen;
}

describe('[SITE-MERGE] the marketing entry is code-split from the app', () => {
  const files = [...graph(resolve(MARKETING_DIR, 'main.ts'))];

  it('resolves at least the entry + the referral util', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('every module in the marketing graph lives under src/marketing', () => {
    for (const f of files) expect(f.startsWith(MARKETING_DIR)).toBe(true);
  });

  it('never imports app code or React (a stranger downloads no app bundle)', () => {
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(BANNED);
  });
});
