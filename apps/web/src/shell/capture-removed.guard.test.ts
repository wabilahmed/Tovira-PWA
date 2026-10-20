// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PRIMARY, OVERFLOW, SIDEBAR, VIEWS, isView } from './nav.js';

/**
 * [P36-3] There is no standalone Capture screen — every capture starts from a client's own page. Nothing
 * may link to the removed view again: not the nav, not a `?view=capture` link, not a setView/onNavigate.
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe('[P36-3] the standalone Capture screen is gone', () => {
  it('is not a view and not in any nav', () => {
    expect(isView('capture')).toBe(false);
    expect((VIEWS as readonly string[]).includes('capture')).toBe(false);
    for (const list of [PRIMARY, OVERFLOW, SIDEBAR]) expect(list.map((n) => n.view as string)).not.toContain('capture');
  });

  it('its component file is deleted', () => {
    expect(existsSync(join(SRC, 'capture/Capture.tsx'))).toBe(false);
  });

  it('no component links to it', () => {
    const LINK = /view=capture|setView\(\s*'capture'|onNavigate\(\s*'capture'|view === 'capture'|<Capture\b/;
    const offenders = files(SRC).filter((f) => LINK.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
