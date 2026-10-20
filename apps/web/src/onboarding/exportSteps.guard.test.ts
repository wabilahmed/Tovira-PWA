// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** [P37] One source for WhatsApp export instructions: no component writes its own "Export Chat … Without Media"
 *  steps; they all render <ExportSteps> (onboarding/exportSteps.tsx). */
const SRC = resolve(process.cwd(), 'apps/web/src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
describe('[P37] export instructions come from one place', () => {
  it('only exportSteps.tsx spells out the WhatsApp export steps', () => {
    const offenders = files(SRC)
      .filter((f) => !f.endsWith('onboarding/exportSteps.tsx'))
      // code comments may name WhatsApp's menu items; only rep-facing strings count
      .filter((f) => /Export Chat|Export chat|Without Media|Without media|Save to Files/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
