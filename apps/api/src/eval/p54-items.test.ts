import { describe, it, expect } from 'vitest';
import { scoreNote, aggregate } from './score.js';
import { evaluateGate } from './gate.js';
import { EVAL_NOTES } from './eval-set.js';
import { isTier1Fixture, tier2ClassOf } from './tier2-classify.js';
import { redactSensitive } from '../services/redaction/redact.js';

// [P54 · owner] The items parked since P50/P53, scored against their own expected output with no model before the real
// certification runs. Indian Tier-1 values must be blanked before the model (a hard zero, receipts included); the
// false-hit control keeps every value and is scored with the normal checks.
const note = (id: string) => EVAL_NOTES.find((n) => n.id === id)!;
const optsFor = (id: string) => ({ tier1: isTier1Fixture(id), aliasClass: tier2ClassOf(id) === 'alias_normalisation', aliases: note(id).aliases ?? [], mustNotFold: note(id).mustNotFold ?? [], folded: [] });
const clean = (id: string) => {
  const n = note(id);
  const s = scoreNote(n.expected, n.expected, n.mustNotMerge, n.forbidden, optsFor(id));
  const g = evaluateGate(aggregate([s]), 'test');
  expect(g.passed, `${id}: ${g.reasons.join('; ')}`).toBe(true);
  expect(s.people.fp + s.people.fn + s.promises.fp + s.promises.fn, id).toBe(0);
  expect(s.tier1Leaked + s.aliasPeople + s.leakedValues, id).toBe(0);
};

export const INDIA_TIER1 = [
  'india-aadhaar-spaced', 'india-aadhaar-run-together', 'india-aadhaar-split-messages', 'india-aadhaar-spoken-voice', 'india-aadhaar-devanagari',
  'india-pan-upper', 'india-pan-lower', 'india-passport-english', 'india-passport-hindi', 'india-bank-ac-no',
];

describe('[P54-1] Indian Tier-1 eval items', () => {
  it('each exists, is a Tier-1 item (a hard zero), carries its value, and redaction blanks every forbidden fragment', () => {
    for (const id of INDIA_TIER1) {
      const n = note(id);
      expect(n, id).toBeDefined();
      expect(isTier1Fixture(id), id).toBe(true);
      expect((n.forbidden ?? []).length, id).toBeGreaterThan(0);
      expect((n.forbidden ?? []).some((f) => n.note.toLowerCase().includes(f.toLowerCase())), `${id} carries the value`).toBe(true);
      const red = redactSensitive(n.note).redacted.toLowerCase();
      for (const f of n.forbidden ?? []) expect(red, `${id}: "${f}" survives redaction`).not.toContain(f.toLowerCase());
    }
  });
  it('each scores clean on every hard bar against its own expected output', () => {
    for (const id of [...INDIA_TIER1, 'india-false-hit-control']) clean(id);
  });
  it('NEGATIVE: the false-hit control keeps every value (a +91 phone, a rupee amount, a PIN code): redaction changes nothing', () => {
    const n = note('india-false-hit-control');
    expect(redactSensitive(n.note).redacted).toBe(n.note);
    expect(n.note).toContain('+91 98765 43210');
    expect(n.note).toContain('₹12,00,000');
    expect(n.note).toContain('560001');
    expect(isTier1Fixture(n.id)).toBe(false);
  });
});
