import { describe, it, expect } from 'vitest';
import { isHealthFact, dropHealthPersonalFacts } from './health-filter.js';

/**
 * [HEALTH-EXCLUSION] The deterministic write-time backstop for Rule 7: a personal_fact tagged `health`
 * is dropped WHOLE before storage, so structured health is per-run zero regardless of the model. It
 * drops the whole fact (never edits text) and touches nothing but health-categorised personal_facts.
 */
describe('[HEALTH-EXCLUSION] dropHealthPersonalFacts', () => {
  it('drops a health-categorised personal_fact and keeps the others byte-identical', () => {
    const ex = {
      summary: 'A note about Sarah.',
      personal_facts: [
        { subject: 'Sarah', fact: 'Recovering from a back injury', category: 'health' },
        { subject: 'Sarah', fact: 'Prefers email over calls', category: 'preference' },
        { subject: 'Klaus', fact: 'Based in Berlin', category: 'background' },
      ],
    };
    const preference = ex.personal_facts[1];
    const background = ex.personal_facts[2];
    const removed = dropHealthPersonalFacts(ex);
    expect(removed).toBe(1);
    expect(ex.personal_facts).toHaveLength(2);
    expect(ex.personal_facts.some((f) => f.category === 'health')).toBe(false);
    // the survivors are the SAME objects — no edit, no reorder
    expect(ex.personal_facts[0]).toBe(preference);
    expect(ex.personal_facts[1]).toBe(background);
    expect(ex.summary).toBe('A note about Sarah.'); // free text untouched
  });

  it('matches health case- and space-insensitively, and only "health"', () => {
    expect(isHealthFact({ category: 'health' })).toBe(true);
    expect(isHealthFact({ category: 'Health' })).toBe(true);
    expect(isHealthFact({ category: '  HEALTH  ' })).toBe(true);
    expect(isHealthFact({ category: 'preference' })).toBe(false);
    expect(isHealthFact({ category: 'healthcare' })).toBe(false); // not an exact category
    expect(isHealthFact({ category: null })).toBe(false);
    expect(isHealthFact({})).toBe(false);
  });

  it('drops every health fact when there are several', () => {
    const ex = { personal_facts: [
      { subject: 'A', fact: 'x', category: 'health' },
      { subject: 'B', fact: 'y', category: 'health' },
      { subject: 'C', fact: 'z', category: 'hobby' },
    ] };
    expect(dropHealthPersonalFacts(ex)).toBe(2);
    expect(ex.personal_facts.map((f) => f.category)).toEqual(['hobby']);
  });

  it('is a no-op (returns 0, no throw) when personal_facts is missing or not an array', () => {
    expect(dropHealthPersonalFacts({})).toBe(0);
    expect(dropHealthPersonalFacts({ personal_facts: undefined })).toBe(0);
    const clean = { personal_facts: [{ subject: 'A', fact: 'x', category: 'hobby' }] };
    expect(dropHealthPersonalFacts(clean)).toBe(0);
    expect(clean.personal_facts).toHaveLength(1);
  });
});
