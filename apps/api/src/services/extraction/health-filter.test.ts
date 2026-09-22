import { describe, it, expect } from 'vitest';
import { isHealthFact, dropHealthPersonalFacts, isSensitiveFact, dropSensitivePersonalFacts, SENSITIVE_CATEGORIES } from './health-filter.js';

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

describe('[SPECIAL-CATEGORY v0.9.7] dropSensitivePersonalFacts covers health + special categories', () => {
  it('the sensitive set is exactly health + the four special categories', () => {
    expect([...SENSITIVE_CATEGORIES].sort()).toEqual(
      ['ethnicity', 'health', 'political_opinion', 'religion', 'sexual_orientation'],
    );
  });

  it('isSensitiveFact matches every sensitive category (case-insensitive) and nothing else', () => {
    for (const c of ['health', 'religion', 'Ethnicity', 'POLITICAL_OPINION', ' sexual_orientation ']) {
      expect(isSensitiveFact({ category: c })).toBe(true);
    }
    for (const c of ['family', 'hobby', 'preference', 'background', 'other', 'politics']) {
      expect(isSensitiveFact({ category: c })).toBe(false);
    }
  });

  it('drops health AND special-category facts whole, keeps ordinary facts byte-identical', () => {
    const keep = { subject: 'A', fact: 'likes golf', category: 'hobby' };
    const ex = { personal_facts: [
      { subject: 'B', fact: 'is religious', category: 'religion' },
      keep,
      { subject: 'C', fact: 'knee surgery', category: 'health' },
      { subject: 'D', fact: 'votes X', category: 'political_opinion' },
    ] };
    expect(dropSensitivePersonalFacts(ex)).toBe(3);
    expect(ex.personal_facts).toEqual([keep]);
    expect(ex.personal_facts[0]).toBe(keep); // same object — no edit
  });
});
