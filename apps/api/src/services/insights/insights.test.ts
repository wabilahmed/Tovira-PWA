import { describe, it, expect } from 'vitest';
import { aggregatePeople, aggregatePersonalFacts } from './insights.js';
import type { Extraction } from '../extraction/types.js';

const ex = (over: Partial<Extraction>): Extraction => ({
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null, ...over,
});

describe('[P4-2] stakeholder aggregation', () => {
  it('links roles and reporting relationships across notes', () => {
    const people = aggregatePeople([
      ex({ people: [{ name: 'Jordan', role: 'VP', reports_to: null, decision_role: 'decision_maker', notes: 'signs off' }] }),
      ex({ people: [{ name: 'Sarah', role: null, reports_to: 'Jordan', decision_role: 'influencer', notes: null }] }),
    ]);
    const jordan = people.find((p) => p.name === 'Jordan')!;
    const sarah = people.find((p) => p.name === 'Sarah')!;
    expect(jordan.decision_role).toBe('decision_maker');
    expect(sarah.reports_to).toBe('Jordan');
  });

  it('keeps an unknown role as unknown (no fabricated title)', () => {
    const [p] = aggregatePeople([ex({ people: [{ name: 'Alex', role: null, reports_to: null, decision_role: 'unknown', notes: null }] })]);
    expect(p!.role).toBeNull();
    expect(p!.decision_role).toBe('unknown');
  });

  it('never merges two distinct names (Sarah vs Sara)', () => {
    const people = aggregatePeople([
      ex({ people: [{ name: 'Sarah', role: null, reports_to: null, decision_role: 'unknown', notes: null }] }),
      ex({ people: [{ name: 'Sara', role: 'finance', reports_to: null, decision_role: 'unknown', notes: null }] }),
    ]);
    expect(people.map((p) => p.name).sort()).toEqual(['Sara', 'Sarah']);
  });

  it('enriches a known role over an earlier unknown, same name', () => {
    const [p] = aggregatePeople([
      ex({ people: [{ name: 'Jordan', role: null, reports_to: null, decision_role: 'unknown', notes: null }] }),
      ex({ people: [{ name: 'Jordan', role: 'VP', reports_to: null, decision_role: 'decision_maker', notes: null }] }),
    ]);
    expect(p!.decision_role).toBe('decision_maker');
    expect(p!.role).toBe('VP');
  });
});

describe('[P4-3] personal-facts aggregation', () => {
  it('keeps each fact attributed to its subject', () => {
    const facts = aggregatePersonalFacts([
      ex({ personal_facts: [{ subject: 'Sarah', fact: 'son started college', category: 'family' }] }),
      ex({ personal_facts: [{ subject: 'Tom', fact: 'keen golfer', category: 'hobby' }] }),
    ]);
    expect(facts.find((f) => f.fact.includes('college'))!.subject).toBe('Sarah');
    expect(facts.find((f) => f.fact.includes('golfer'))!.subject).toBe('Tom');
  });

  it('deduplicates identical subject+fact', () => {
    const facts = aggregatePersonalFacts([
      ex({ personal_facts: [{ subject: 'Sarah', fact: 'son started college', category: 'family' }] }),
      ex({ personal_facts: [{ subject: 'Sarah', fact: 'son started college', category: 'family' }] }),
    ]);
    expect(facts).toHaveLength(1);
  });
});
