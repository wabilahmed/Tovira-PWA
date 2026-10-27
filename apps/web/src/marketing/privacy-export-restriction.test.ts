import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const parse = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');

// [P48 · owner] Lawyer-approved, word for word: the export withholds a restricted person during a review
// (086074d), so the Privacy page says so where it promises reps a copy of their data (section 13).
const LINE = 'While a privacy request about someone else is being reviewed, data about that person may be held back from your copy. It is not deleted.';

describe('[P48] Privacy says a restricted person may be held back from the rep\'s copy', () => {
  it('the exact line sits in section 13, right after the promise of a copy', () => {
    const d = parse('apps/web/privacy/index.html');
    const h = [...d.querySelectorAll('h2')].find((x) => x.textContent === '13. Your rights')!;
    const promise = h.nextElementSibling!;
    expect(promise.textContent).toMatch(/^You can ask us to give you a copy of your data/);
    expect(promise.nextElementSibling!.textContent).toBe(LINE);
  });

  it('the page is dated and versioned 27 October 2026', () => {
    expect(read('apps/web/privacy/index.html')).toContain('Last updated: 27 October 2026 · Version 2026-10-27');
  });

  it('NEGATIVE: the line appears once, and the Terms are unchanged by it', () => {
    expect(read('apps/web/privacy/index.html').split(LINE)).toHaveLength(2);
    expect(read('apps/web/terms/index.html')).not.toContain('held back from your copy');
  });
});
