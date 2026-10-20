// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P37 · owner, 20 Oct] No rep-facing copy shows an AED-of-AI figure (what the AI allowance or usage is worth in
 * dirhams). Prices a rep pays (AED 299 / month, "AED 50: +50% of your monthly allowance") are fine; "your AI
 * allowance … AED 60" is not. Scans every non-test web source with comments stripped.
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
// An AED amount within a few words of allowance / AI / usage, either order.
const AI_COST = /(allowance|\bAI\b|usage)[^'"`<>{}\n]{0,40}AED\s*[\d,.]+|AED\s*[\d,.]+[^'"`<>{}\n]{0,40}(allowance|\bAI\b|usage)/i;

describe('[P37] no AED-of-AI figures in rep-facing copy', () => {
  it('no web source pairs an AED amount with the allowance / AI / usage', () => {
    const offenders = files(SRC).filter((f) => AI_COST.test(strip(readFileSync(f, 'utf8')))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the guard catches the old line', () => {
    expect(AI_COST.test("'Subscribing resets your AI allowance to the full AED 60.'")).toBe(true);
    expect(AI_COST.test("'Subscribing gives you a full month\\'s allowance.'")).toBe(false);
    expect(AI_COST.test('`AED ${o.priceAed}: ${o.label} of your monthly allowance`')).toBe(false); // a price, not a cost
  });
});
