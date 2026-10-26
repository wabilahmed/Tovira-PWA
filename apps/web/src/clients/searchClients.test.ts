import { describe, it, expect } from 'vitest';
import { searchClients, searchIsActive, normalizeArabic, canonicalPhone, digitsOf, type SearchableClient } from './searchClients.js';

const C = (name: string, phone: string | null = null, email: string | null = null): SearchableClient & { id: string } =>
  ({ id: name, name, phone, email });

/** The one matched hit's client name (asserts exactly one match unless noted). */
function names(clients: Array<SearchableClient & { id: string }>, q: string): string[] {
  return searchClients(clients, q).hits.map((h) => (h.client as { name: string }).name);
}

describe('[CLIENT-SEARCH] normalisation primitives', () => {
  it('folds Arabic forms and strips diacritics + tatweel', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabic('آمنة')).toBe('امنه'); // آ→ا and ة→ه
    expect(normalizeArabic('عَلِيّ')).toBe('علي'); // diacritics gone
    expect(normalizeArabic('مـــحمد')).toBe('محمد'); // tatweel gone
    expect(normalizeArabic('ليلى')).toBe('ليلي'); // ى→ي
  });
  it('lowercases Latin text for case-insensitive compare', () => {
    expect(normalizeArabic('AhMeD')).toBe('ahmed');
  });
  it('canonicalPhone makes trunk-0, 971 and the 00 international prefix equivalent', () => {
    expect(canonicalPhone(digitsOf('+971 50 123 4567'))).toBe('501234567');
    expect(canonicalPhone(digitsOf('050 123 4567'))).toBe('501234567');
    expect(canonicalPhone(digitsOf('971501234567'))).toBe('501234567');
    // [CLI-11] 00 is the international dial prefix, the same as '+'.
    expect(canonicalPhone(digitsOf('00971501234567'))).toBe('501234567');
    expect(canonicalPhone(digitsOf('00971-50-123-4567'))).toBe('501234567');
    // A stray trunk zero after the country code still canonicalises.
    expect(canonicalPhone(digitsOf('+971 0 50 123 4567'))).toBe('501234567');
    // A non-UAE international number keeps its own country code — must NOT collapse to a UAE number.
    expect(canonicalPhone(digitsOf('0044 20 7946 0958'))).toBe('442079460958');
  });
});

describe('[CLIENT-SEARCH] searchIsActive (min length: 2 text, 3 digits)', () => {
  it('requires 2 chars for text, 3 digits for a phone query', () => {
    expect(searchIsActive('a')).toBe(false);
    expect(searchIsActive('ah')).toBe(true);
    expect(searchIsActive('45')).toBe(false); // 2 digits — too short
    expect(searchIsActive('456')).toBe(true);
    expect(searchIsActive('  ')).toBe(false);
  });
});

describe('[CLIENT-SEARCH] matching by field', () => {
  const clients = [
    C('Ahmed Khan', '+971 50 123 4567', 'ahmed@emaar.ae'),
    C('Northwind Trading', '050 987 6543', 'ops@northwind.co'),
    C('أحمد منصور', '+971 55 222 1111', null),
    C('Budget Buyer', null, 'info@damac.ae'),
  ];

  it('partial, case-insensitive name match (ahm → Ahmed)', () => {
    expect(names(clients, 'ahm')).toContain('Ahmed Khan');
    expect(names(clients, 'AHM')).toContain('Ahmed Khan');
  });

  it('Arabic query finds the diacritic/hamza form (احمد → أحمد منصور)', () => {
    expect(names(clients, 'احمد')).toContain('أحمد منصور');
  });

  it('trailing-digits phone match (4567 → +971 50 123 4567)', () => {
    expect(names(clients, '4567')).toEqual(['Ahmed Khan']);
  });

  it('phone match respects 0 / 971 equivalence (050… finds +971 50…)', () => {
    // '0501234567' canonicalises to '501234567', matching the stored +971 50 123 4567.
    expect(names(clients, '0501234567')).toEqual(['Ahmed Khan']);
    expect(names(clients, '971501234567')).toEqual(['Ahmed Khan']);
  });

  it('[CLI-11] matches a 00-prefixed international number, and dashes/spaces anywhere', () => {
    expect(names(clients, '00971501234567')).toEqual(['Ahmed Khan']);
    expect(names(clients, '00971-50-123-4567')).toEqual(['Ahmed Khan']);
    expect(names(clients, '00 971 50 123 4567')).toEqual(['Ahmed Khan']);
  });

  it('[CLI-11] a different country code (0044…) does NOT falsely match a UAE number', () => {
    expect(names(clients, '0044501234567')).toEqual([]);
  });

  it('email substring match (@emaar → the emaar address)', () => {
    expect(names(clients, '@emaar')).toEqual(['Ahmed Khan']);
    expect(names(clients, 'damac')).toEqual(['Budget Buyer']);
  });

  it('reports WHICH field matched', () => {
    expect(searchClients(clients, 'ahm').hits[0]!.field).toBe('name');
    expect(searchClients(clients, '4567').hits[0]!.field).toBe('phone');
    expect(searchClients(clients, '@emaar').hits[0]!.field).toBe('email');
  });

  it('no match → empty hits (clear no-results)', () => {
    expect(searchClients(clients, 'zzzzz').hits).toEqual([]);
    expect(searchClients(clients, 'zzzzz').active).toBe(true);
  });

  it('below the min length → inactive (caller shows the full list)', () => {
    expect(searchClients(clients, 'a').active).toBe(false);
    expect(searchClients(clients, 'a').hits).toEqual([]);
  });
});

describe('[CLIENT-SEARCH] scales to a full book (client-side over the loaded list)', () => {
  // The whole list is loaded and searched in the browser; prove the 600th client is found by name,
  // phone and email — nothing is capped or paged away.
  const big = Array.from({ length: 600 }, (_, i) =>
    C(`Client ${i + 1}`, i === 599 ? '+971 50 999 6000' : null, i === 599 ? 'ops@zephyr600.ae' : null),
  );
  big[599]!.name = 'Zephyr Logistics 600';

  it('finds client #600 by name', () => {
    expect(names(big, 'zephyr')).toEqual(['Zephyr Logistics 600']);
  });
  it('finds client #600 by its phone digits', () => {
    expect(names(big, '9996000')).toEqual(['Zephyr Logistics 600']);
  });
  it('finds client #600 by email', () => {
    expect(names(big, 'zephyr600.ae')).toEqual(['Zephyr Logistics 600']);
  });
});

describe('[CLIENT-SEARCH] ranking exact → prefix → substring', () => {
  const clients = [C('Ahmed'), C('Mohammed Ahmed'), C('Ahmedabad Textiles')];
  it('orders exact, then prefix, then mid-substring', () => {
    expect(names(clients, 'ahmed')).toEqual(['Ahmed', 'Ahmedabad Textiles', 'Mohammed Ahmed']);
    const ranks = searchClients(clients, 'ahmed').hits.map((h) => h.rank);
    expect(ranks).toEqual([0, 1, 2]);
  });
});

describe('[CLIENT-SEARCH] highlight ranges map to the ORIGINAL string', () => {
  it('highlights the matched slice of a Latin name', () => {
    const [hit] = searchClients([C('Ahmed Khan')], 'khan').hits;
    const r = hit!.ranges[0]!;
    expect('Ahmed Khan'.slice(r.start, r.end)).toBe('Khan');
  });
  it('highlights across stripped diacritics in the original Arabic', () => {
    const [hit] = searchClients([C('عَلِيّ')], 'علي').hits;
    const r = hit!.ranges[0]!;
    // The original (with harakat) slice covers the whole name the folded match spans.
    expect('عَلِيّ'.slice(r.start, r.end)).toContain('ع');
  });
  it('highlights the matched digits inside a formatted phone', () => {
    const [hit] = searchClients([C('A', '+971 50 123 4567')], '4567').hits;
    const r = hit!.ranges[0]!;
    expect('+971 50 123 4567'.slice(r.start, r.end)).toBe('4567');
  });
});

// [P46-4] Phones are stored canonical (+971503863103) and shown in international format, in search results too.
describe('[P46-4] a phone match reads in international format', () => {
  it('"386 31" finds +971503863103 and shows "+971 50 386 3103"', () => {
    const hit = searchClients([{ id: 'c1', name: 'Sara', phone: '+971503863103' }], '386 31').hits[0]!;
    expect(hit.field).toBe('phone');
    expect(hit.value).toBe('+971 50 386 3103');
  });
});
