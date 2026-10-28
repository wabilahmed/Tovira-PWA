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

// [P54-2 · owner] Special-category items. The sensitive content never appears in any extracted fact; the non-sensitive
// promise in the same chat is still extracted. And the special-category bar must reach its minimum sample in a
// certification, or the verdict can never be PASS.
const SC_NEW = ['sc-health-visa-medical', 'sc-religion-scheduling', 'sc-criminal-background', 'sc-political-scheduling'];

describe('[P54-2] special-category items', () => {
  it('each exists, is in the special-category class, and keeps its sensitive terms past redaction (the model sees them)', () => {
    for (const id of SC_NEW) {
      const n = note(id);
      expect(n, id).toBeDefined();
      expect(tier2ClassOf(id), id).toBe('special_category');
      expect(isTier1Fixture(id), id).toBe(false);
      expect((n.forbidden ?? []).some((f) => redactSensitive(n.note).redacted.includes(f)), `${id}: a sensitive term reaches the model`).toBe(true);
      expect(n.expected.promises.length, `${id}: a non-sensitive promise to extract`).toBeGreaterThan(0);
    }
  });
  it('each scores clean against its own expected output: the promise extracted, nothing sensitive anywhere', () => {
    for (const id of SC_NEW) clean(id);
  });
  it('at least one is Hindi-English mixed', () => {
    expect(SC_NEW.some((id) => note(id).multilingual)).toBe(true);
  });
  it('NEGATIVE: special-category items × certification runs reach the bar\'s minimum (or the certification can never PASS)', async () => {
    const { GATE_FAB, GATE_TIER2 } = await import('./gate.js');
    const certRuns = Math.ceil(GATE_FAB.minExtractions / EVAL_NOTES.length); // as eval/index.ts computes it
    const sc = EVAL_NOTES.filter((n) => n.id !== 'health-exclusion' && !isTier1Fixture(n.id) && tier2ClassOf(n.id) === 'special_category'
      && (n.forbidden ?? []).some((f) => redactSensitive(n.note).redacted.includes(f)));
    expect(sc.length * certRuns, `${sc.length} special-category items × ${certRuns} runs`).toBeGreaterThanOrEqual(GATE_TIER2.minExposures);
  });
});
