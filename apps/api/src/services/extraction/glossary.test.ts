import { describe, it, expect } from 'vitest';
import { buildGlossary, renderGlossary } from './glossary.js';
import type { RepGlossaryEntry } from '../../ports/rep-glossary-repository.js';

// [NO-TRAINING-RETENTION] buildGlossary now reads the operational rep_glossary table. The term-length +
// non-term/edit-only gate lives at the verdict upsert (verdict.test.ts) and the DB check constraints
// (migration 0076); buildGlossary's own job is just the "corrected twice" threshold + the size cap.
function entry(wrongTerm: string, rightTerm: string, timesCorrected: number): RepGlossaryEntry {
  return { wrongTerm, rightTerm, timesCorrected, firstSeen: 1, lastSeen: 2 };
}

describe('buildGlossary (P4-9)', () => {
  it('carries a term the rep has corrected at least twice', () => {
    const g = buildGlossary([entry('Meridiun', 'Meridian', 2)]);
    expect(g).toEqual([{ wrong: 'Meridiun', right: 'Meridian' }]);
  });

  it('ignores a term corrected only once (below the threshold)', () => {
    expect(buildGlossary([entry('Acmee', 'Acme', 1)])).toEqual([]);
  });

  it('ignores a no-op pair even above the threshold', () => {
    expect(buildGlossary([entry('same', 'same', 5)])).toEqual([]);
  });

  it('caps the glossary size', () => {
    const many: RepGlossaryEntry[] = [];
    for (let i = 0; i < 40; i++) many.push(entry(`wrong${i}`, `right${i}`, 2));
    expect(buildGlossary(many).length).toBeLessThanOrEqual(25);
  });
});

describe('renderGlossary (P4-9)', () => {
  it('renders the mapping with note-wins guidance', () => {
    const text = renderGlossary([{ wrong: 'Meridiun', right: 'Meridian' }]);
    expect(text).toMatch(/Meridiun/);
    expect(text).toMatch(/Meridian/);
    expect(text).toMatch(/note.*win/i); // the note's words always win over the glossary
  });

  it('renders empty string for no entries (no glossary block at all)', () => {
    expect(renderGlossary([])).toBe('');
  });
});
