import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AuthShell } from './AuthShell.js';

// [P62-2 · owner] The app's tagline is "Memory for sales people whose clients stay for years." everywhere it appears; the
// old "Your deal, Our memory, Instant success." is gone from the app (and from emails, P61-5).
describe('[P62-2] the tagline', () => {
  it('the sign-in and request-form header shows the new line', () => {
    render(<AuthShell subtitle="Request beta access"><p>x</p></AuthShell>);
    expect(screen.getByText('Memory for sales people whose clients stay for years.')).toBeInTheDocument();
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
