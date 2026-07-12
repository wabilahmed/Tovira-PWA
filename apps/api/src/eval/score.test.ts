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
});
