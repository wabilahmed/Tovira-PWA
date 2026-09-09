import { describe, it, expect } from 'vitest';
import { scoreInvariants, type InvariantContract } from './score-invariants.js';
import type { Extraction } from '../services/extraction/types.js';

/**
 * [GATE-IMPORT-SIZE] The scorer's OWN gate. A new certification metric that cannot fail would give a
 * green cert proving nothing — the exact "metric shipped dark" trap (leakedValues, the confidence
 * check, nullNamed). So before this scorer gates any spend, prove BOTH directions: it PASSES a clean
 * result, and it FAILS — with a named violation — for every invariant type, fed a deliberately
 * violating result.
 */
const empty: Extraction = {
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
};

// A contract exercising every assertion type (shaped like the hard Imtinan fixture).
const CONTRACT: InvariantContract = {
  id: 'self-test',
  requiredPromises: [
    { match: 'hold that price', dueYear: undefined }, // must be present (date unchecked)
    { match: 'renewal', dueYear: 2021 },              // multi-year: must resolve to 2021
    { match: 'after the summer', dueYear: null },     // must have NO date (no guess)
  ],
  forbiddenPromises: [{ match: 'ignore that' }],      // a retracted commitment must not surface
  requiredPeople: [{ name: 'Imtinan', decisionRole: 'decision_maker' }],
  forbiddenEntities: ['Gulf Distributors', 'Dana'],   // competitor / other-chat contact
  requiredDates: [{ match: 'renewal', year: 2023 }],
  mustNotMerge: [['Sarah', 'Sara']],
};

// A result that satisfies EVERY clause.
const CLEAN: Extraction = {
  ...empty,
  promises: [
    { text: 'Hold that price for the client', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' },
    { text: 'Send the renewal before the 30th', owner: 'rep', due_date: '2021-06-30', due_raw: 'before the 30th', confidence: 'high' },
    { text: 'Circle back after the summer', owner: 'rep', due_date: null, due_raw: 'after the summer', confidence: 'low' },
  ],
  people: [
    { name: 'Imtinan Qureshi', role: null, reports_to: null, decision_role: 'decision_maker', notes: null },
    { name: 'Sarah', role: null, reports_to: null, decision_role: 'unknown', notes: null },
    { name: 'Sara', role: 'finance', reports_to: null, decision_role: 'unknown', notes: null },
  ],
  key_dates: [{ description: 'Contract renewal', date: '2023-09-01', date_raw: 'renewal', type: 'renewal' }],
};

describe('[GATE-IMPORT-SIZE] scoreInvariants — the scorer must be able to both pass and fail', () => {
  it('PASSES a clean result with zero violations', () => {
    const r = scoreInvariants(CONTRACT, CLEAN);
    expect(r.violations).toEqual([]);
    expect(r.passed).toBe(true);
  });

  // [FALSE-NEGATIVE GUARD] A scorer must MATCH a legitimately-worded-differently correct answer, not
  // only fail a wrong one — else it reports a phantom miss (IMPORT-DIAG: the engine split a promise
  // across text + due_raw and reworded another; matching only .text read as "3 promises lost"). False
  // negatives are as damaging as false positives — they send you chasing a model bug that isn't there.
  it('MATCHES a required promise the engine split across text and due_raw (not only exact .text)', () => {
    const c: InvariantContract = { id: 'fn', requiredPromises: [{ match: 'renewal before the 30th' }] };
    const a: Extraction = { ...empty, promises: [{ text: 'Send the renewal', owner: 'rep', due_date: null, due_raw: 'before the 30th', confidence: 'high' }] };
    expect(scoreInvariants(c, a).passed, 'phrase split text/due_raw must still match').toBe(true);
  });

  it('MATCHES a required promise on its distinctive keyword when the engine rewords it', () => {
    // Anchor targets the concept ("circle back"); engine says "Circle back on the account".
    const c: InvariantContract = { id: 'fn2', requiredPromises: [{ match: 'circle back' }] };
    const a: Extraction = { ...empty, promises: [{ text: 'Circle back on the account', owner: 'rep', due_date: null, due_raw: 'after the summer', confidence: 'low' }] };
    expect(scoreInvariants(c, a).passed, 'reworded-but-correct promise must match its keyword').toBe(true);
  });

  it('FAILS an empty result — every required clause is violated', () => {
    const r = scoreInvariants(CONTRACT, empty);
    expect(r.passed).toBe(false);
    // missing: 3 promises + 1 person + 1 date + the must-not-merge pair = 6 violations
    expect(r.violations.length).toBeGreaterThanOrEqual(6);
  });

  // Each invariant type, proven to fire individually (a regression in one is pinpointed).
  it('flags a MISSING required promise', () => {
    const a = { ...CLEAN, promises: CLEAN.promises.filter((p) => !p.text.includes('Hold that price')) };
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /missing required promise.*hold that price/i.test(x))).toBe(true);
  });

  it('flags a WRONG-YEAR date on a required promise (multi-year integrity)', () => {
    const a = { ...CLEAN, promises: CLEAN.promises.map((p) => p.text.includes('renewal') ? { ...p, due_date: '2026-06-30' } : p) };
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /resolve to 2021/.test(x))).toBe(true);
  });

  it('flags a GUESSED date where it must be null', () => {
    const a = { ...CLEAN, promises: CLEAN.promises.map((p) => p.text.includes('after the summer') ? { ...p, due_date: '2023-09-15' } : p) };
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /must have NO date/.test(x))).toBe(true);
  });

  it('flags a FORBIDDEN (retracted) promise that resurfaced', () => {
    const a = { ...CLEAN, promises: [...CLEAN.promises, { text: 'Ignore that, we are not doing it', owner: 'rep' as const, due_date: null, due_raw: null, confidence: 'low' as const }] };
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /forbidden promise/i.test(x))).toBe(true);
  });

  it('flags a missing required person AND a wrong decision_role', () => {
    const missing = { ...CLEAN, people: CLEAN.people.filter((p) => !(p.name ?? '').includes('Imtinan')) };
    expect(scoreInvariants(CONTRACT, missing).violations.some((x) => /missing required person/i.test(x))).toBe(true);
    const wrongRole = { ...CLEAN, people: CLEAN.people.map((p) => (p.name ?? '').includes('Imtinan') ? { ...p, decision_role: 'influencer' as const } : p) };
    expect(scoreInvariants(CONTRACT, wrongRole).violations.some((x) => /decision_role must be decision_maker/.test(x))).toBe(true);
  });

  it('flags a FORBIDDEN ENTITY leaking into any field (cross-attribution / competitor)', () => {
    const inPromise = { ...CLEAN, promises: [...CLEAN.promises, { text: 'Beat Gulf Distributors on price', owner: 'rep' as const, due_date: null, due_raw: null, confidence: 'low' as const }] };
    expect(scoreInvariants(CONTRACT, inPromise).violations.some((x) => /Gulf Distributors/.test(x))).toBe(true);
    const inPerson = { ...CLEAN, people: [...CLEAN.people, { name: 'Dana', role: null, reports_to: null, decision_role: 'unknown' as const, notes: null }] };
    expect(scoreInvariants(CONTRACT, inPerson).violations.some((x) => /Dana/.test(x))).toBe(true);
  });

  it('flags a wrong-year required DATE', () => {
    const a = { ...CLEAN, key_dates: [{ description: 'Contract renewal', date: '2026-09-01', date_raw: 'renewal', type: 'renewal' }] };
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /date "renewal" must resolve to 2023/.test(x))).toBe(true);
  });

  it('flags MERGED people (the must-not-merge pair collapsed to one)', () => {
    const a = { ...CLEAN, people: CLEAN.people.filter((p) => p.name !== 'Sara') }; // Sara merged away
    expect(scoreInvariants(CONTRACT, a).violations.some((x) => /must-not-merge/.test(x))).toBe(true);
  });
});
