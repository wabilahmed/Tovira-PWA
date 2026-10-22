// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** [P39-8] The receipt thread never overlaps anything: the bubble's time is in the flow (not pinned over the
 *  text), and "Show the conversation" sits on its own line. */
const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/theme.css'), 'utf8');
const rule = (sel: string): string => new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('[P39-8] receipt thread layout', () => {
  it('the time is not absolutely positioned', () => {
    expect(rule('.tov-bubble__time')).not.toMatch(/position:\s*absolute/);
  });
  it('"Show the conversation" is a block on its own line, at least 44px tall', () => {
    expect(rule('.tov-thread__more')).toMatch(/display:\s*(block|flex)/);
    expect(rule('.tov-thread__more')).toMatch(/min-height:\s*var\(--touch\)/);
  });
});
