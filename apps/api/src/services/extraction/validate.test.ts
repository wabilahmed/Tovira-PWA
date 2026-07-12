import { describe, it, expect } from 'vitest';
import { validateExtraction } from './validate.js';

const valid = {
  summary: 'ok',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
};

describe('validateExtraction', () => {
  it('accepts a well-formed empty extraction', () => {
    expect(validateExtraction(valid).ok).toBe(true);
  });

  it('accepts a full extraction with valid entries', () => {
    const full = {
      ...valid,
      promises: [{ text: 'send quote', owner: 'rep', due_date: '2026-07-10', due_raw: 'Friday', confidence: 'high' }],
      people: [{ name: 'Jordan', role: 'VP', reports_to: null, decision_role: 'decision_maker', notes: null }],
      meeting: { datetime: null, datetime_raw: 'Thursday 3pm', confirmed: false },
    };
    expect(validateExtraction(full).ok).toBe(true);
  });

  it('rejects a missing top-level key', () => {
    const { promises: _omit, ...missing } = valid;
    void _omit;
    const result = validateExtraction(missing);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/promises/);
  });

  it('rejects a wrong container type', () => {
    expect(validateExtraction({ ...valid, promises: 'nope' }).ok).toBe(false);
  });

  it('rejects a promise with an invalid owner (guards garbage spine data)', () => {
    const bad = { ...valid, promises: [{ text: 'x', owner: 'nobody', due_date: null, due_raw: null, confidence: 'high' }] };
    expect(validateExtraction(bad).ok).toBe(false);
  });

  it('rejects a person with an invalid decision_role', () => {
    const bad = { ...valid, people: [{ name: 'X', role: null, reports_to: null, decision_role: 'boss', notes: null }] };
    expect(validateExtraction(bad).ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validateExtraction('not json').ok).toBe(false);
    expect(validateExtraction(null).ok).toBe(false);
  });
});
