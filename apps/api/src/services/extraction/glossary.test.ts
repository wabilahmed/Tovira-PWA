import { describe, it, expect } from 'vitest';
import { buildGlossary, renderGlossary } from './glossary.js';
import type { CorrectionRecord } from '../../ports/correction-repository.js';

let seq = 0;
function correction(before: string | null, after: string | null, field = 'text'): CorrectionRecord {
  return {
    id: `c${seq++}`, userId: 'u1', noteId: 'n1', entityType: 'promise', entityId: 'p1',
    field, before, after, promptVersion: 'v', createdAt: seq,
  };
}

describe('buildGlossary (P4-9)', () => {
  it('carries a term the rep has corrected at least twice', () => {
    const g = buildGlossary([correction('Meridiun', 'Meridian'), correction('Meridiun', 'Meridian')]);
    expect(g).toEqual([{ wrong: 'Meridiun', right: 'Meridian' }]);
  });

  it('ignores a term corrected only once (below the threshold)', () => {
    expect(buildGlossary([correction('Acmee', 'Acme')])).toEqual([]);
  });

  it('ignores no-op, null, and non-term (date/confidence) corrections', () => {
    const g = buildGlossary([
      correction('same', 'same'),
      correction(null, 'x'),
      correction('x', null),
      correction('2026-08-01', '2026-08-02', 'due_date'),
      correction('2026-08-01', '2026-08-02', 'due_date'),
      correction('low', 'high', 'confidence'),
      correction('low', 'high', 'confidence'),
    ]);
    expect(g).toEqual([]);
  });

  it('drops paragraph-length corrections (only term-sized entries)', () => {
    const long = 'a'.repeat(60);
    expect(buildGlossary([correction(long, long + 'b'), correction(long, long + 'b')])).toEqual([]);
  });

  it('caps the glossary size', () => {
    const many: CorrectionRecord[] = [];
    for (let i = 0; i < 40; i++) { many.push(correction(`wrong${i}`, `right${i}`)); many.push(correction(`wrong${i}`, `right${i}`)); }
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
