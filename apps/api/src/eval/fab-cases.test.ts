import { describe, it, expect } from 'vitest';
import { unmatchedPromises, formatFabCase } from './fab-cases.js';
import type { Extraction, ExtractedPromise } from '../services/extraction/types.js';

// [P48 · owner] The gate counted fabricated promises but never said which one. Each unmatched promise is now named
// (eval item, run, what was predicted, its quote), using the certified scorer's own matching, unchanged.
const empty = { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null } as unknown as Extraction;
const pr = (text: string, extra: Partial<ExtractedPromise> = {}): ExtractedPromise => ({ text, owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: null, source_message_at: null, ...extra });
const expected = { ...empty, promises: [pr('Send the revised quote')] } as Extraction;

describe('[P48] the gate names each fabricated promise', () => {
  it('returns the predicted promise that matched no expected one, and only that one', () => {
    const actual = { ...empty, promises: [pr('Send the revised quote tomorrow'), pr('Have the proposal ready before March', { source_span: 'يبون العرض جاهز قبله' })] } as Extraction;
    expect(unmatchedPromises(expected, actual).map((p) => p.text)).toEqual(['Have the proposal ready before March']);
  });

  it('NEGATIVE: a promise that matches is never reported, and no extraction reports nothing', () => {
    expect(unmatchedPromises(expected, { ...empty, promises: [pr('Send the revised quote')] } as Extraction)).toEqual([]);
    expect(unmatchedPromises(expected, null)).toEqual([]);
  });

  it('a second copy of a matched promise is the unmatched one (the scorer matches each expected promise once)', () => {
    const actual = { ...empty, promises: [pr('Send the revised quote'), pr('Send the revised quote')] } as Extraction;
    expect(unmatchedPromises(expected, actual)).toHaveLength(1);
  });

  it('agrees with the scorer\'s count on every case', async () => {
    const { scoreNote } = await import('./score.js');
    const cases = [
      { ...empty, promises: [pr('Send the revised quote'), pr('Call Ahmed'), pr('Send the revised quote')] },
      { ...empty, promises: [pr('Send the brochure', { owner: 'client' })] },
      { ...empty, promises: [] },
    ] as Extraction[];
    for (const a of cases) expect(unmatchedPromises(expected, a)).toHaveLength(scoreNote(expected, a).fabricatedPromises);
  });

  it('formats a case with the item, run, promise, owner, confidence, date phrase, quote and what was expected', () => {
    const line = formatFabCase('ml-arabic-two-people-visit', 3, pr('Continue the discussion later', { due_raw: 'بعدين', confidence: 'low', source_span: 'اتفقنا نكمل بعدين' }), []);
    expect(line).toBe('[gate]   fab in "ml-arabic-two-people-visit" (run 3): predicted "Continue the discussion later" owner=rep confidence=low due_raw="بعدين" quote="اتفقنا نكمل بعدين" · expected: [none]');
  });
});

describe('[P48] the gate logs every fabricated promise, every run', () => {
  it('index.ts prints each unmatched promise inside the run loop, for the whole set', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const loop = src.slice(src.indexOf('for (const run of Array.from'), src.indexOf('allScores.push('));
    expect(loop).toMatch(/for \(const s of scored\)[\s\S]*unmatchedPromises\(s\.note\.expected, s\.actual\)[\s\S]*formatFabCase\(s\.note\.id, run,/);
  });
  it('NEGATIVE: the fabrication reporter stays off the gate surfaces (adding it never restarts the window)', async () => {
    const { NARROW_SURFACE, CERT_SURFACE } = await import('./extraction-fingerprint.js');
    expect([...NARROW_SURFACE, ...CERT_SURFACE]).not.toContain('eval/fab-cases.ts');
    expect([...NARROW_SURFACE, ...CERT_SURFACE]).not.toContain('eval/index.ts');
  });
});
