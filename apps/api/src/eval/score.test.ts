import { describe, it, expect } from 'vitest';
import { scoreNote, aggregate } from './score.js';
import type { Extraction } from '../services/extraction/types.js';

const base: Extraction = {
  summary: '',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
};

const promise = (text: string, due_date: string | null = null) => ({
  text,
  owner: 'rep' as const,
  due_date,
  due_raw: 'Friday',
  confidence: 'high' as const,
});

describe('scoreNote', () => {
  it('counts a matched promise as a true positive', () => {
    const expected = { ...base, promises: [promise('send the revised quote')] };
    const actual = { ...base, promises: [promise('send revised quote to them')] };
    const s = scoreNote(expected, actual);
    expect(s.promises.tp).toBe(1);
    expect(s.fabricatedPromises).toBe(0);
  });

  it('counts a fabricated promise (no expected match) as fp + fabricated', () => {
    const expected = { ...base, promises: [] };
    const actual = { ...base, promises: [promise('loop in finance next week')] };
    const s = scoreNote(expected, actual);
    expect(s.promises.fp).toBe(1);
    expect(s.fabricatedPromises).toBe(1);
  });

  it('flags a guessed date (truth null, prediction a specific date)', () => {
    const expected = { ...base, promises: [promise('circle back on the contract', null)] };
    const actual = { ...base, promises: [promise('circle back on the contract', '2026-02-01')] };
    expect(scoreNote(expected, actual).guessedDates).toBe(1);
  });

  it('a fabricated promise with a date counts as fabrication only, NOT a separate guessed date', () => {
    // A phantom promise's date is part of the fabrication (aggregate bar), not a
    // date-resolution error on a real commitment (guessedDates, per-run zero). Counting it
    // twice would let any dated fabrication re-fail the per-run guessed bar, undoing the
    // owner ruling that fabrication is aggregate-only.
    const expected = { ...base, promises: [] };
    const actual = { ...base, promises: [promise('loop in finance', '2026-03-01')] };
    const s = scoreNote(expected, actual);
    expect(s.fabricatedPromises).toBe(1);
    expect(s.guessedDates).toBe(0);
  });

  it('flags a false certainty (truth low-confidence, prediction high) on a matched promise', () => {
    const low = { ...promise('circle back on the contract', null), confidence: 'low' as const };
    const high = { ...promise('circle back on the contract', null), confidence: 'high' as const };
    // truth low, predicted high → an unconfirmed guess presented as a fact
    expect(scoreNote({ ...base, promises: [low] }, { ...base, promises: [high] }).falseCertainties).toBe(1);
    // truth low, predicted low → fine
    expect(scoreNote({ ...base, promises: [low] }, { ...base, promises: [low] }).falseCertainties).toBe(0);
    // truth high, predicted high → fine (a firm promise stays firm)
    expect(scoreNote({ ...base, promises: [high] }, { ...base, promises: [high] }).falseCertainties).toBe(0);
  });


  it('flags a null/empty-named person (role-only) — Rule 5, now gate-scored', () => {
    const named = { name: 'Priya', role: null, reports_to: null, decision_role: 'unknown' as const, notes: null };
    const roleOnly = { name: '', role: 'the buyer', reports_to: null, decision_role: 'unknown' as const, notes: null };
    expect(scoreNote(base, { ...base, people: [roleOnly] }).nullNamedPeople).toBe(1);
    expect(scoreNote(base, { ...base, people: [named] }).nullNamedPeople).toBe(0);
  });

  it('flags a leaked sensitive value/fragment in the output (REDACT-5)', () => {
    const withValue = { ...base, summary: 'send to AE070331234567890123456 today' };
    expect(scoreNote(base, withValue, [], ['AE0703']).leakedValues).toBe(1);
    expect(scoreNote(base, { ...base, summary: 'nothing sensitive' }, [], ['AE0703']).leakedValues).toBe(0);
  });

  it('counts a missed promise as a false negative', () => {
    const expected = { ...base, promises: [promise('send the MSA')] };
    expect(scoreNote(expected, { ...base, promises: [] }).promises.fn).toBe(1);
  });

  it('handles a null (failed) extraction as all-missed', () => {
    const expected = { ...base, promises: [promise('send the MSA')], people: [{ name: 'Jo', role: null, reports_to: null, decision_role: 'unknown' as const, notes: null }] };
    const s = scoreNote(expected, null);
    expect(s.promises.fn).toBe(1);
    expect(s.people.fn).toBe(1);
  });

  it('aggregates precision and recall across notes', () => {
    const a = scoreNote({ ...base, promises: [promise('x')] }, { ...base, promises: [promise('x')] });
    const b = scoreNote({ ...base, promises: [promise('y')] }, { ...base, promises: [] });
    const agg = aggregate([a, b]);
    expect(agg.promises.recall).toBeCloseTo(0.5); // 1 of 2 caught
    expect(agg.promises.precision).toBe(1); // no false positives
  });

  // REQ-CERT: the new requirements metric must be able to FAIL, or it isn't a metric.
  const req = (text: string, raw: string, stated_on: string | null = '2026-07-09', confidence: 'high' | 'low' = 'high') =>
    ({ text, requirement_raw: raw, stated_on, confidence });

  it('counts a matched requirement as a true positive', () => {
    const s = scoreNote(
      { ...base, requirements: [req('A 2-bed near the marina', 'looking for a 2-bed near the marina')] },
      { ...base, requirements: [req('2-bed apartment near marina', 'wants a 2-bed near the marina')] },
    );
    expect(s.requirements.tp).toBe(1);
    expect(s.requirementFalsePositives).toBe(0);
  });

  it('flags a concern emitted as a requirement as a false positive (the concern↔requirement leak)', () => {
    const s = scoreNote(
      { ...base, requirements: [], concerns: ['Pricing is above her budget'] },
      { ...base, requirements: [req('Lower pricing', 'the pricing is above her budget')] },
    );
    expect(s.requirements.fp).toBe(1);
    expect(s.requirementFalsePositives).toBe(1);
  });

  it('flags stated_on ≠ the key on a matched requirement (Rule 8 / DATE-REF)', () => {
    const s = scoreNote(
      { ...base, requirements: [req('A 3-bed in Mirdif', 'looking for a 3-bed in Mirdif', '2026-03-15')] },
      { ...base, requirements: [req('A 3-bed in Mirdif', 'looking for a 3-bed in Mirdif', '2026-07-09')] },
    );
    expect(s.requirements.tp).toBe(1);
    expect(s.requirementDateErrors).toBe(1);
  });

  it('flags a conditional requirement (key low) returned high as confidence inflation', () => {
    const s = scoreNote(
      { ...base, requirements: [req('Two units', 'if the budget clears she would take two units', '2026-07-09', 'low')] },
      { ...base, requirements: [req('Two units', 'if the budget clears she would take two units', '2026-07-09', 'high')] },
    );
    expect(s.requirementConfInflation).toBe(1);
  });

  it('counts a missed requirement as a false negative', () => {
    const s = scoreNote({ ...base, requirements: [req('A 1-bed in JLT', 'a 1-bed in JLT')] }, { ...base, requirements: [] });
    expect(s.requirements.fn).toBe(1);
  });
});
