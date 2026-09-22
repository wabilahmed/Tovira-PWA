import { describe, it, expect } from 'vitest';
import { tier2ClassOf, classifyLeaks, tier2Bar, tier2Bars, type LeakRecord } from './tier2-classify.js';
import type { Extraction } from '../services/extraction/types.js';

const empty: Extraction = {
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [],
  concerns: [], next_steps: [], requirements: [], meeting: null,
};
const ex = (o: Partial<Extraction>): Extraction => ({ ...empty, ...o });

describe('[TIER2-SPLIT] class attribution', () => {
  it('maps each fixture to its class; unknown → other', () => {
    expect(tier2ClassOf('special-category-not-a-fact')).toBe('special_category');
    expect(tier2ClassOf('client-person-alias')).toBe('alias_normalisation');
    expect(tier2ClassOf('some-other-fixture')).toBe('other');
  });
});

describe('[TIER2-SPLIT] classifyLeaks — which field a term landed in', () => {
  it('flags a personal_fact leak as STRUCTURED', () => {
    const recs = classifyLeaks('special-category-not-a-fact', ['religious'],
      ex({ personal_facts: [{ subject: 'Client', fact: 'is religious', category: 'background' }] }));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ term: 'religious', field: 'personal_facts', structured: true, cls: 'special_category' });
  });

  it('flags a summary/concern leak as FREE TEXT', () => {
    const recs = classifyLeaks('special-category-not-a-fact', ['votes'],
      ex({ summary: 'He votes for the National party.' }));
    expect(recs[0]).toMatchObject({ term: 'votes', field: 'summary', structured: false, cls: 'special_category' });
  });

  it('records one leak per forbidden term that appears; none when clean', () => {
    expect(classifyLeaks('x', ['religious', 'votes'], ex({ summary: 'clean note' }))).toEqual([]);
    const two = classifyLeaks('special-category-not-a-fact', ['religious', 'votes'],
      ex({ summary: 'religious', concerns: ['votes'] }));
    expect(two.map((r) => r.field)).toEqual(['summary', 'concerns']);
  });

  it('returns nothing on a null extraction or empty forbidden', () => {
    expect(classifyLeaks('x', ['a'], null)).toEqual([]);
    expect(classifyLeaks('x', [], ex({ summary: 'a' }))).toEqual([]);
  });
});

describe('[TIER2-SPLIT] per-class bars — one class never hides or is blamed for another', () => {
  // Leaks are attributed AND counted per leaking exposure (fixture, run). The two special-category
  // leaks are in different runs → two leaking exposures; the alias leak is a third exposure.
  const records: Array<LeakRecord & { run: number }> = [
    { fixtureId: 'special-category-not-a-fact', term: 'religious', field: 'summary', structured: false, cls: 'special_category', run: 1 },
    { fixtureId: 'special-category-not-a-fact', term: 'votes', field: 'summary', structured: false, cls: 'special_category', run: 2 },
    { fixtureId: 'client-person-alias', term: 'Bubu', field: 'people', structured: true, cls: 'alias_normalisation', run: 1 },
  ];
  const exposures = { special_category: 20, alias_normalisation: 20 };

  it('counts each class independently (special_category=2, alias=1) — no cross-contamination', () => {
    const bars = tier2Bars(records, exposures, 12, 8);
    const sc = bars.find((b) => b.cls === 'special_category')!;
    const alias = bars.find((b) => b.cls === 'alias_normalisation')!;
    expect(sc.leaks).toBe(2);   // ONLY the two special-category leaking exposures
    expect(alias.leaks).toBe(1); // the alias leak is NOT counted under special_category
    expect(sc.ratePct).toBeCloseTo(10);   // 2/20
    expect(alias.ratePct).toBeCloseTo(5);  // 1/20
  });

  it('counts LEAKING EXPOSURES, not term-hits — overlapping terms in one exposure count once, rate ≤ 100%', () => {
    // client-person-alias forbids both 'Bubu' and 'Bubu DXB'; one echo trips both → two term-records,
    // but it is ONE leaking exposure (one fixture, one run). Term-hit counting gave 2/1 = 200%.
    const oneEcho: Array<LeakRecord & { run: number }> = [
      { fixtureId: 'client-person-alias', term: 'Bubu DXB', field: 'people', structured: true, cls: 'alias_normalisation', run: 1 },
      { fixtureId: 'client-person-alias', term: 'Bubu', field: 'people', structured: true, cls: 'alias_normalisation', run: 1 },
    ];
    const alias = tier2Bars(oneEcho, { alias_normalisation: 1 }, 12, 8).find((b) => b.cls === 'alias_normalisation')!;
    expect(alias.leaks).toBe(1);   // one leaking exposure, not two term-hits
    expect(alias.ratePct).toBe(100); // 1/1 — never 200%
    expect(alias.ratePct).toBeLessThanOrEqual(100);
  });

  it('the special_category bar FAILS at 2/20=10% > 8%, while alias PASSES at 5% — independently', () => {
    const bars = tier2Bars(records, exposures, 12, 8);
    expect(bars.find((b) => b.cls === 'special_category')!.passed).toBe(false);
    expect(bars.find((b) => b.cls === 'alias_normalisation')!.passed).toBe(true);
  });

  it('an alias-only leak never fails the special_category bar (0 leaks → pass)', () => {
    const aliasOnly = records.filter((r) => r.cls === 'alias_normalisation');
    const bars = tier2Bars(aliasOnly, exposures, 12, 8);
    expect(bars.find((b) => b.cls === 'special_category')!.leaks).toBe(0);
    expect(bars.find((b) => b.cls === 'special_category')!.passed).toBe(true);
  });

  it('is PROVISIONAL below minExposures (small sample not certifiable)', () => {
    expect(tier2Bar('special_category', 0, 3, 12, 8).provisional).toBe(true);
    expect(tier2Bar('special_category', 0, 20, 12, 8).provisional).toBe(false);
  });
});
