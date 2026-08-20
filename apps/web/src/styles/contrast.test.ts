import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// [TOKENS §2] Body text meets AA on BOTH materials; every brass/claret accent
// pairing is verified. We parse the SHARED tokens file (the single source of
// truth imported by both apps/web and apps/site) so the test can never drift
// from the shipped tokens — and so it covers the marketing site's palette too.
const css = readFileSync(fileURLToPath(new URL('../../../../packages/brand/tokens.css', import.meta.url)), 'utf8');

function block(selector: string): Record<string, string> {
  // Grab the first `{ ... }` after the selector and pull `--name: #hex;` pairs.
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6});/g)) out[m[1]!] = m[2]!;
  return out;
}

function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// brand v1.2: Ledger (light) is the default — the bare `:root {` block. Vault
// (dark) lives under the manual-override selector. We test BOTH full token sets;
// the light theme is the drift risk (warm gray-on-cream), so it is held to the
// same floors as dark.
const ledger = block(':root {');
const vault = block(":root[data-theme='vault']");

describe.each([
  ['Ledger (light, default)', ledger],
  ['Vault (dark)', vault],
])('%s token contrast', (_name, t) => {
  // Body text: AA is the floor, AAA (7.0) is the target for the PRIMARY reading
  // colour — both themes must actually hit it.
  it('primary body text clears AAA (7.0) on base, raised and elevated surfaces', () => {
    for (const surface of ['--surface-base', '--surface-raised', '--surface-elevated']) {
      expect(contrast(t['--text-primary']!, t[surface]!)).toBeGreaterThanOrEqual(7.0);
    }
  });

  it('secondary text clears AA (4.5) on base, raised and elevated surfaces', () => {
    for (const surface of ['--surface-base', '--surface-raised', '--surface-elevated']) {
      expect(contrast(t['--text-secondary']!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('brass, claret, amber and green accents clear the UI-component floor (3.0) on every surface', () => {
    for (const surface of ['--surface-base', '--surface-raised', '--surface-elevated']) {
      for (const accent of ['--brass', '--claret', '--amber', '--green']) {
        expect(contrast(t[accent]!, t[surface]!), `${accent} on ${surface}`).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  // The semantic hues must stay DISTINCT from each other — the accent can never
  // be mistaken for "act" (claret) or "uncertain" (amber).
  it('accent, claret and amber are visibly distinct colours', () => {
    expect(contrast(t['--brass']!, t['--claret']!)).not.toBe(1);
    for (const [a, b] of [['--brass', '--claret'], ['--brass', '--amber'], ['--claret', '--amber']] as const) {
      expect(t[a]).not.toBe(t[b]);
    }
  });

  // A brass FILL carries brass-ink text (buttons) — that pairing must be legible.
  it('brass-ink on a brass fill clears AA (4.5)', () => {
    expect(contrast(t['--brass-ink']!, t['--brass']!)).toBeGreaterThanOrEqual(4.5);
  });
});
