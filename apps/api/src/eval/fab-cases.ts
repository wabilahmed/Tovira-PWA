import { scoreNote } from './score.js';
import type { Extraction, ExtractedPromise } from '../services/extraction/types.js';

/**
 * [P48 · owner] Name each fabricated promise. The gate counted them (score.ts: a predicted promise with no matching
 * expected one) but never said which. This reuses the certified scorer unchanged rather than copying its matching rule:
 * the scorer matches predicted promises in order, each against the first expected promise still free, so promise i is
 * unmatched exactly when scoring the first i+1 promises counts one more fabrication than scoring the first i.
 * Outside the gate surfaces on purpose (eval/extraction-fingerprint.ts): reporting, not scoring.
 */
export function unmatchedPromises(expected: Extraction, actual: Extraction | null): ExtractedPromise[] {
  if (!actual) return [];
  const out: ExtractedPromise[] = [];
  let prev = 0;
  actual.promises.forEach((p, i) => {
    const n = scoreNote(expected, { ...actual, promises: actual.promises.slice(0, i + 1) }).fabricatedPromises;
    if (n > prev) out.push(p);
    prev = n;
  });
  return out;
}

const q = (s: string | null | undefined): string => (s ? `"${s}"` : 'none');

export function formatFabCase(itemId: string, run: number, p: ExtractedPromise, expected: ExtractedPromise[]): string {
  const exp = expected.length ? expected.map((e) => `"${e.text}" (${e.owner})`).join(', ') : 'none';
  return `[gate]   fab in "${itemId}" (run ${run}): predicted "${p.text}" owner=${p.owner} confidence=${p.confidence} due_raw=${q(p.due_raw)} quote=${q(p.source_span)} · expected: [${exp}]`;
}
