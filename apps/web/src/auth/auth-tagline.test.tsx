import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AuthShell } from './AuthShell.js';

// [P62-2 · owner] The app's tagline is "Memory for sales people whose clients stay for years." everywhere it appears; the
// old "Your deal, Our memory, Instant success." is gone from the app (and from emails, P61-5).
describe('[P62-2] the tagline', () => {
  // [P90 · owner, Prompt 88, batch 1] moved: "Remove the tagline under the logo". The signed-out header is the logo and
  // "Home"; no tagline at all (the P69 line "What each client cares about, in front of you when it matters." is gone
  // from these screens, and the older lines stay gone).
  it('the sign-in and request-form header shows no tagline', () => {
    const { container } = render(<AuthShell subtitle="Request beta access"><p>x</p></AuthShell>);
    expect(screen.queryByText('What each client cares about, in front of you when it matters.')).toBeNull();
    expect(container.querySelector('.auth__tagline')).toBeNull();
    expect(screen.queryByText(/memory for sales people/i)).toBeNull();
  });
  it('NEGATIVE: the old tagline appears nowhere in the web app\'s source or pages', () => {
    const root = join(process.cwd(), 'apps/web');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (['node_modules', 'dist'].includes(f)) return [];
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|html|css)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
    const hits = [...files(join(root, 'src')), ...files(root).filter((f) => f.endsWith('.html'))].filter((f) => /instant success/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
