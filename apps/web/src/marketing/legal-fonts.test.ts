import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [TASK 4] The shared brand font loader (packages/brand/fonts.css) is pulled in by the legal pages'
 * stylesheet (site.css) and by nothing else — the product app (main.tsx) and the Starfield landing
 * (marketing/fonts.css) each load their own slices directly. So the brand loader must carry ONLY the
 * families the legal pages actually render (Fraunces, IBM Plex Sans/Arabic/Mono). Archivo and IBM Plex
 * Sans weight 300 belong to the landing alone; shipping them here just makes /privacy and /terms declare
 * ~96 KB of woff2 they never paint. This guard fails if either creeps back into the shared loader, and
 * asserts the landing keeps its own three families.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('[TASK 4] legal pages do not ship fonts they never render', () => {
  const brand = read('../../../../packages/brand/fonts.css');
  const landing = read('./fonts.css');

  it('the shared brand loader imports neither Archivo nor IBM Plex Sans 300', () => {
    expect(brand).not.toMatch(/@fontsource\/archivo/);
    expect(brand).not.toMatch(/ibm-plex-sans\/latin-300/);
  });

  it('the shared brand loader still carries the families the legal pages use', () => {
    expect(brand).toMatch(/@fontsource-variable\/fraunces/); // --font-display
    expect(brand).toMatch(/ibm-plex-sans\/latin-400/); //      --font-sans
    expect(brand).toMatch(/ibm-plex-sans-arabic\/arabic-400/); // --font-arabic
    expect(brand).toMatch(/ibm-plex-mono\/latin-400/); //      --font-mono
  });

  it('the Starfield landing keeps loading its own three families (unchanged)', () => {
    expect(landing).toMatch(/@fontsource\/archivo/);
    expect(landing).toMatch(/ibm-plex-sans\/latin-300/);
    expect(landing).toMatch(/ibm-plex-mono\/latin-400/);
  });
});
