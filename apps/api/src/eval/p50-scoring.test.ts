import { describe, it, expect } from 'vitest';
import { scoreNote, aggregate } from './score.js';
import { evaluateGate, extractForEval, foldedBy } from './gate.js';
import { EVAL_NOTES } from './eval-set.js';
import { isTier1Fixture, tier2ClassOf, classifyLeaks } from './tier2-classify.js';
import { redactSensitive } from '../services/redaction/redact.js';
import type { Extraction } from '../services/extraction/types.js';
import type { ModelClient } from '../ports/model.js';

// [P50-3/4 · owner] The gate measures merges and Tier-1 leaks as zeros:
//  - a person folded into the client who only shares a word with them (mustNotFold) is a merged person: hard zero;
//  - the client under an exact alias stored as a separate person (aliasPeople) is a hard zero (P43-4);
//  - a Tier-1 value anywhere in the output, receipts included, on a Tier-1 item is a hard zero (it used to count only
//    toward the Tier-2 rate bar);
//  - the alias measure ignores receipts: a verbatim quote keeps the WhatsApp label ("[…] Bubu DXB: morning!").
const empty: Extraction = { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null } as unknown as Extraction;
const person = (name: string, extra: Record<string, unknown> = {}) => ({ name, role: null, reports_to: null, decision_role: 'unknown', notes: null, ...extra });
const note = (id: string) => EVAL_NOTES.find((n) => n.id === id)!;
const gate = (s: ReturnType<typeof scoreNote>) => evaluateGate(aggregate([s]), 'test');
const optsFor = (id: string, folded: string[] = []) => ({ tier1: isTier1Fixture(id), aliasClass: tier2ClassOf(id) === 'alias_normalisation', aliases: note(id).aliases ?? [], mustNotFold: note(id).mustNotFold ?? [], folded });

describe('[P50] Tier-1: any fragment in the output is a hard zero', () => {
  it('a card fragment inside a receipt on a Tier-1 item fails the run', () => {
    const n = note('tier1-card-split-messages');
    const out = { ...empty, people: [person('Omar Haddad', { source_span: 'second half 0343 6467' })] } as unknown as Extraction;
    const s = scoreNote(n.expected, out, n.mustNotMerge, n.forbidden, optsFor(n.id));
    expect(s.tier1Leaked).toBeGreaterThan(0);
    expect(gate(s).passed).toBe(false);
    expect(gate(s).reasons.join(' ')).toMatch(/Tier-1/);
  });
  it('NEGATIVE: the redacted placeholder (last four only) is not a leak', () => {
    const n = note('tier1-card-spaces');
    const out = { ...empty, summary: 'Omar sent [card ending 6467] for the deposit.' } as unknown as Extraction;
    expect(scoreNote(n.expected, out, n.mustNotMerge, n.forbidden, optsFor(n.id)).tier1Leaked).toBe(0);
  });
  it('every Tier-1 item carries its value in the note, and redaction blanks every forbidden fragment before the model', () => {
    const ids = EVAL_NOTES.filter((n) => isTier1Fixture(n.id)).map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['tier1-card-spaces', 'tier1-card-dashes', 'tier1-card-split-messages', 'tier1-iban-spaces', 'tier1-iban-lowercase', 'tier1-eid-no-dashes', 'tier1-eid-arabic-indic', 'tier1-eid-spoken-voice', 'redact-iban-card', 'redact-emirates-id']));
    for (const id of ids) {
      const n = note(id);
      expect((n.forbidden ?? []).length, id).toBeGreaterThan(0);
      expect((n.forbidden ?? []).some((f) => n.note.toLowerCase().includes(f.toLowerCase())), `${id} really carries the value`).toBe(true);
      const red = redactSensitive(n.note).redacted.toLowerCase();
      for (const f of n.forbidden ?? []) expect(red, `${id}: "${f}" survives redaction`).not.toContain(f.toLowerCase());
    }
  });
});

describe('[P50 · P43-4] aliases', () => {
  it('the alias measure ignores receipts: the WhatsApp label in a verbatim quote is not a leak', () => {
    const n = note('client-person-alias');
    const out = { ...empty, people: [person('Imtinan Qureshi', { source_span: '[08/06/2026, 09:10] Bubu DXB: morning!' })] } as unknown as Extraction;
    expect(scoreNote(n.expected, out, n.mustNotMerge, n.forbidden, optsFor(n.id)).leakedValues).toBe(0);
    expect(classifyLeaks(n.id, n.forbidden ?? [], out)).toEqual([]);
  });
  it('NEGATIVE: the alias in a name, a role or a note is still a leak', () => {
    const n = note('client-person-alias');
    const out = { ...empty, people: [person('Imtinan Qureshi', { notes: 'saved as Bubu DXB' })] } as unknown as Extraction;
    expect(scoreNote(n.expected, out, n.mustNotMerge, n.forbidden, optsFor(n.id)).leakedValues).toBeGreaterThan(0);
  });
  it('NEGATIVE: the client under an exact alias as a separate person is a hard zero (aliasPeople)', () => {
    for (const id of ['client-person-alias', 'merge-shared-word-alias', 'client-exact-alias-folds']) {
      const n = note(id);
      const out = { ...empty, people: [person(n.aliases![0]!)] } as unknown as Extraction;
      const s = scoreNote(n.expected, out, n.mustNotMerge, n.forbidden, optsFor(id));
      expect(s.aliasPeople, id).toBe(1);
      expect(gate(s).passed, id).toBe(false);
    }
  });
});

describe('[P50] a wrong fold is a merged person', () => {
  it('a mustNotFold name the fold renamed into the client counts as merged and fails the run', () => {
    for (const [id, name] of [['merge-shared-first-name', 'Khalid'], ['merge-shared-word-alias', 'Hills Properties'], ['hindi-english-resolvable', 'Rajesh']] as const) {
      const n = note(id);
      const s = scoreNote(n.expected, n.expected, n.mustNotMerge, n.forbidden, optsFor(id, [name]));
      expect(s.mergedPeople, id).toBe(1);
      expect(gate(s).passed, id).toBe(false);
    }
  });

  it('through extractForEval: the exact-name fold leaves the driver, Hills Properties and Rajesh alone, and folds the exact alias', async () => {
    const cases: Array<[string, Array<ReturnType<typeof person>>, string[]]> = [
      ['merge-shared-first-name', [person('Khalid Al Mansoori'), person('Khalid', { role: 'driver' })], ['Khalid Al Mansoori', 'Khalid']],
      ['merge-shared-word-alias', [person('Ahmed Dubai Hills'), person('Hills Properties')], ['Ahmed Al Falasi', 'Hills Properties']],
      ['hindi-english-resolvable', [person('Rajesh')], ['Rajesh']],
      ['client-exact-alias-folds', [person('Fatoom Villas')], ['Fatima Al Suwaidi']],
    ];
    for (const [id, people, expectNames] of cases) {
      const n = note(id);
      const model: ModelClient = { complete: async () => ({ text: JSON.stringify({ ...empty, summary: n.expected.summary, people }) }) };
      const ex = await extractForEval(model, n, { aliases: n.aliases });
      expect(ex!.people.map((p) => p.name), id).toEqual(expectNames);
      const s = scoreNote(n.expected, ex, n.mustNotMerge, n.forbidden, optsFor(id, foldedBy(ex)));
      expect(s.mergedPeople, id).toBe(0);
      expect(s.aliasPeople, id).toBe(0);
    }
  });
});

describe('[P50] every new item scores clean against its own expected output (before the real gate)', () => {
  it('the expected output of each new item passes every hard bar with full precision and recall', () => {
    const ids = ['merge-shared-first-name', 'merge-shared-word-alias', 'client-exact-alias-folds', 'tier1-card-spaces', 'tier1-card-dashes', 'tier1-card-split-messages', 'tier1-iban-spaces', 'tier1-iban-lowercase', 'tier1-eid-no-dashes', 'tier1-eid-arabic-indic', 'tier1-eid-spoken-voice'];
    for (const id of ids) {
      const n = note(id);
      expect(n, id).toBeDefined();
      const s = scoreNote(n.expected, n.expected, n.mustNotMerge, n.forbidden, optsFor(id));
      expect(gate(s).passed, `${id}: ${gate(s).reasons.join('; ')}`).toBe(true);
      expect(s.people.fp + s.people.fn, id).toBe(0);
      expect(s.tier1Leaked + s.aliasPeople + s.leakedValues, id).toBe(0);
    }
  });
});
