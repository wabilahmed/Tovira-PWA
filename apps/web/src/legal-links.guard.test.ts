import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P22-1] Every legal link the app renders (Terms, Privacy, any legal page) must be RELATIVE — same
 * origin as the app — never an absolute URL. An absolute legal URL is how the consent checkbox ended up
 * pointing at a live site we don't own. Scans every component source in apps/web/src.
 */
const ROOT = resolve(process.cwd(), 'apps/web/src');
const LEGAL = /href=\{?["'`]([^"'`]*(?:terms|privacy|legal|cookie)[^"'`]*)["'`]/gi;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('[P22-1] legal links are same-origin', () => {
  it('every href to a terms / privacy / legal page is relative', () => {
    const bad: string[] = [];
    for (const file of sources(ROOT)) {
      for (const m of readFileSync(file, 'utf8').matchAll(LEGAL)) {
        const href = m[1]!;
        if (!href.startsWith('/')) bad.push(`${relative(ROOT, file)}: ${href}`);
      }
    }
    expect(bad, `absolute legal links:\n${bad.join('\n')}`).toEqual([]);
  });
});
