// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P39-9 · owner] Rep-facing copy never says "moments", "Unsorted", "Worth checking" or "entry/entries" — in the
 * app's strings and JSX text, and in the server copy that reaches a rep (Book Scan headlines, import errors).
 * Comments and identifiers don't count. And the landing page's two lines read as the owner wrote them.
 */
const ROOT = resolve(process.cwd());
const BANNED = /\bmoments\b|\bunsorted\b|worth checking|\bentr(?:y|ies)\b/i;
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'marketing' || f === 'node_modules' ? [] : files(p, ext)) : ext.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
function repFacingStrings(src: string): string[] {
  const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
  // identifiers / values like 'unsorted' (the filter's id) and 'worth_checking' (an enum) are not copy
  return out.filter((t) => t.includes(' ') || /^[A-Z]/.test(t));
}

describe('[P39-9] rep-facing copy', () => {
  it('no "moments", "Unsorted", "Worth checking" or "entry/entries" in the app', () => {
    const hits = files(join(ROOT, 'apps/web/src'), /\.tsx?$/).flatMap((f) => repFacingStrings(readFileSync(f, 'utf8')).filter((t) => BANNED.test(t)).map((t) => `${relative(ROOT, f)}: ${t}`));
    expect(hits).toEqual([]);
  });

  it('…nor in the server copy that reaches a rep (Book Scan, import errors)', () => {
    const surfaces = ['apps/api/src/services/book-scan/book-scan-service.ts', 'apps/api/src/services/import/zip.ts'];
    const hits = surfaces.flatMap((f) => repFacingStrings(readFileSync(join(ROOT, f), 'utf8')).filter((t) => BANNED.test(t)).map((t) => `${f}: ${t}`));
    expect(hits).toEqual([]);
  });

  it('the landing page: "Cancel anytime from Settings → Subscription" and "One plan. No tiers, no seats to count."', () => {
    const html = readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('Cancel anytime from Settings → Subscription.');
    expect(html).toContain('One plan. No tiers, no seats to count.');
    expect(html).not.toContain('Cancel anytime from Billing');
    expect(html).not.toContain('no add-ons');
  });
});
