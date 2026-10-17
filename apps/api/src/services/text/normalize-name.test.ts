import { describe, it, expect } from 'vitest';
import { normalizeName, namesEqual, nameMentionedIn } from './normalize-name.js';

describe('[P16] normalizeName', () => {
  it('folds case, punctuation and whitespace runs', () => {
    expect(normalizeName('  Sara   Khan! ')).toBe('sara khan');
    expect(normalizeName('ACME-Corp, Ltd.')).toBe('acme corp ltd');
  });
  it('strips Latin diacritics', () => {
    expect(normalizeName('José Peña')).toBe(normalizeName('Jose Pena'));
  });
  it('folds Arabic letter-form variants + diacritics (أحمد ≈ احمد)', () => {
    expect(normalizeName('أَحْمَد')).toBe(normalizeName('احمد'));
    expect(normalizeName('مُحمّد')).toBe(normalizeName('محمد'));
  });
});

describe('[P16] namesEqual (whole-string, for import mismatch)', () => {
  it('equal after normalisation, not on a mere substring', () => {
    expect(namesEqual('Sara Khan', 'sara  khan')).toBe(true);
    expect(namesEqual('أحمد', 'احمد')).toBe(true);
    expect(namesEqual('Sara', 'Sara Khan')).toBe(false); // substring is NOT equality
    expect(namesEqual('', 'anything')).toBe(false);
  });
});

describe('[P16] nameMentionedIn (token overlap, for meeting parse)', () => {
  it('matches a client name token inside a free-text request', () => {
    expect(nameMentionedIn('Sara Khan', 'catch up with Sara about the JVC unit')).toBe(true);
    expect(nameMentionedIn('Meridian Corp', 'meeting with meridian friday')).toBe(true);
  });
  it('does not match when no token appears', () => {
    expect(nameMentionedIn('Meridian Corp', 'lunch with Ahmed tomorrow')).toBe(false);
    expect(nameMentionedIn('A', 'a quick note')).toBe(false); // 1-char tokens ignored
  });
});
