// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P35-3] One receipt component everywhere. Every surface that shows where something came from renders it with
 * <ReceiptThread>; no surface keeps its own receipt formatting (the old Receipt chit, the P34 SourceLine, or an
 * inline “quote”). Add a new receipt surface here — and it must use the shared component.
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
const SURFACES = [
  'recall/Ask.tsx',                 // Ask answers, count/list lines, near-misses
  'hero/HeroInsights.tsx',          // Today entries
  'confirm/ConfirmChitQueue.tsx',   // To Confirm cards, Ask captures, kept-promise suggestions (promise + delivery)
  'bookscan/BookScan.tsx',          // Book Scan items
  'brief/BriefOpenPromises.tsx',    // client page: open promises
  'App.tsx',                        // client page: recent context (related notes)
  'clients/PointersCard.tsx',       // pointer "why" receipts
  'monday/MondayDigest.tsx',        // Monday Statement: unanswered questions, matches not acted on
  'inventory/MatchSuggestion.tsx',  // inventory matches (client page + inventory)
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe('[P35-3] every receipt surface uses <ReceiptThread>', () => {
  for (const s of SURFACES) {
    it(`${s} renders its receipts with ReceiptThread`, () => {
      const code = readFileSync(join(SRC, s), 'utf8');
      expect(code).toMatch(/import \{[^}]*\bReceiptThread\b[^}]*\} from '[./]*\/?(?:\.\.\/)?receipts\/ReceiptThread\.js'|from '\.\/receipts\/ReceiptThread\.js'/);
      expect(code).toMatch(/<ReceiptThread\b/);
    });
  }

  it('no file outside the shared component imports the old Receipt chit or SourceLine', () => {
    const offenders = files(SRC)
      .filter((f) => !f.includes(`${'/'}receipts${'/'}`) && !f.endsWith('components/Receipt.tsx') && !f.endsWith('components/SourceLine.tsx'))
      .filter((f) => /from '[^']*components\/(Receipt|SourceLine)\.js'/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
