import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [P71-F · owner] "Make sure the font on the new landing page and all other pages is the same. Landing page font is the
 * one we use." The landing's three families are now the site's: Fraunces (headings), Inter (body) and JetBrains Mono
 * (labels), each with its metric-matched fallback, for the app, Privacy, Terms, request access, sign-in and admin. IBM
 * Plex Sans Arabic stays only for Arabic text (Inter has no Arabic letters).
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const tokens = read('../../../../packages/brand/tokens.css');
const token = (name: string): string => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)![1]!;

describe('[P71-F] one set of fonts on every page', () => {
  it('the shared tokens lead with the landing families', () => {
    expect(token('font-sans')).toMatch(/^'Inter', 'Inter Fallback'/);
    expect(token('font-mono')).toMatch(/^'JetBrains Mono', 'JetBrains Mono Fallback'/);
    expect(token('font-display')).toMatch(/Fraunces/);
    expect(token('font-arabic')).toMatch(/^'IBM Plex Sans Arabic'/);
    expect(tokens).not.toMatch(/'IBM Plex Sans',|'IBM Plex Mono'/);
  });
  it('the app and the legal pages load Inter and JetBrains Mono (the landing\'s own files), not IBM Plex Sans or Mono', () => {
    const shared = read('./site-fonts.css');
    expect(shared).toMatch(/font-family: Inter;[^}]*inter-latin-400-normal\.woff2/);
    expect(shared).toMatch(/font-family: 'JetBrains Mono';[^}]*jetbrains-mono-latin-500-normal\.woff2/);
    const main = read('../main.tsx');
    expect(main).toMatch(/import '\.\/styles\/site-fonts\.css'/);
    expect(main).not.toMatch(/ibm-plex-sans\/|ibm-plex-mono\//);
    const brand = read('../../../../packages/brand/fonts.css');
    expect(brand).toMatch(/site-fonts\.css/);
    expect(brand).not.toMatch(/ibm-plex-sans\/|ibm-plex-mono\//);
    expect(read('../marketing/landing-fonts.css')).toMatch(/@import '\.\.\/styles\/site-fonts\.css'/);
  });
});
