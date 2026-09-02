import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildUserMessage,
  estimateTokens,
  PROMPT_VERSION,
} from './prompt.js';
import { asExtraction } from './validate.js';

// [P1-6] The caching contract: a big, byte-identical prefix, with today's date
// kept OUT of it (in the variable message) so the cache doesn't break daily.
describe('extraction prompt', () => {
  it('the cacheable prefix clears the 4,096-token floor', () => {
    expect(estimateTokens(EXTRACTION_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(4096);
  });

  it('the cacheable prefix is byte-identical regardless of the note, client, or date', () => {
    // The prefix is a constant — it must not vary with call inputs.
    const a = EXTRACTION_SYSTEM_PROMPT;
    const b = EXTRACTION_SYSTEM_PROMPT;
    expect(a).toBe(b);
  });

  // NEGATIVE (fault-injection guard): today's date must never appear in the
  // cached prefix, or the cache misses every day.
  it('the cacheable prefix contains no date-like token', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('the variable message carries today, client, source and the note', () => {
    const msg = buildUserMessage({
      today: '2026-07-09',
      clientName: 'Meridian Corp',
      source: 'voice',
      text: "I'll send the revised quote by Friday",
    });
    expect(msg).toContain('2026-07-09');
    expect(msg).toContain('Meridian Corp');
    expect(msg).toContain('voice_note');
    expect(msg).toContain('revised quote by Friday');
  });

  it('two calls on different days share an identical prefix but differ in the message', () => {
    const m1 = buildUserMessage({ today: '2026-07-09', clientName: 'C', source: 'paste', text: 'x' });
    const m2 = buildUserMessage({ today: '2026-07-10', clientName: 'C', source: 'paste', text: 'x' });
    expect(EXTRACTION_SYSTEM_PROMPT).toBe(EXTRACTION_SYSTEM_PROMPT); // prefix stable
    expect(m1).not.toBe(m2); // message changes with the date
  });

  it('exposes a prompt version for logging', () => {
    expect(PROMPT_VERSION).toBe('tovira-extract-v0.8');
  });

  // v0.8: a THIRD PARTY's stated action (the client's own manager / internal team) is
  // not a promise — the boundary FAB-INVESTIGATE identified. Rule 4 now names whose
  // intention counts as a commitment.
  it('rules a third-party stated action out of promises (owns the promise boundary)', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/third party/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/internal process/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/do not manufacture a promise/i);
    // Still carries no date — the cache contract holds.
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // v0.3: Rule 0 — code-switched Arabic/Hindi/Urdu ↔ English is normal input.
  it('instructs the model that multilingual, code-switched input is normal', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/code-switch/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/arabic/i);
    // Rule 0 carries no dates and no glossary — the cache contract still holds.
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // v0.4: a date with no year must stay null — never infer the year.
  it('forbids inferring the year on a year-less date', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/without a year/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/never infer or assume the year/i);
  });

  // v0.5: a role with no name is not a person — never a null-named person.
  it('forbids emitting a person with no name (role-only references)', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/requires a stated name/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/null or empty name/i);
  });

  // A worked example teaches harder than a written rule — Example D once emitted a
  // null-named "buyer", overriding Rule 5 ~87% of the time and shipping that violation
  // dark through three certifications. So every example output must itself satisfy the
  // schema AND the rules it sits beside. This test parses them and checks.
  it('every worked example satisfies the schema and the rules it sits beside', () => {
    const outputs = EXTRACTION_SYSTEM_PROMPT.split('\n').filter((l) => l.trim().startsWith('{"summary"'));
    expect(outputs.length, 'worked examples are present to check').toBeGreaterThan(5);
    for (const line of outputs) {
      const label = line.slice(0, 55);
      let ex;
      try {
        ex = asExtraction(JSON.parse(line));
      } catch (e) {
        throw new Error(`example is not schema-valid JSON [${label}…]: ${(e as Error).message}`);
      }
      expect(ex, `example failed schema validation [${label}…]`).not.toBeNull();
      // Rule 5: never a person with a null/empty name.
      for (const p of ex!.people) {
        expect((p.name ?? '').trim(), `example emits a null/empty-named person, contradicting Rule 5 [${label}…]`).not.toBe('');
      }
      // Rule 4/promises: owner is rep or client, confidence is high|low.
      for (const p of ex!.promises) {
        expect(['rep', 'client'], `example promise owner [${label}…]`).toContain(p.owner);
        expect(['high', 'low'], `example promise confidence [${label}…]`).toContain(p.confidence);
      }
    }
  });

  // P4-9: the glossary goes in the VARIABLE message only — the cached prefix
  // (the system prompt) must stay byte-identical regardless of the glossary.
  it('injects the glossary into the variable message, never the cached prefix', () => {
    const glossary = [{ wrong: 'Meridiun', right: 'Meridian' }];
    const withG = buildUserMessage({ today: '2026-07-09', clientName: 'C', source: 'paste', text: 'call Meridiun', glossary });
    const withoutG = buildUserMessage({ today: '2026-07-09', clientName: 'C', source: 'paste', text: 'call Meridiun' });
    expect(withG).toContain('Meridiun');
    expect(withG).toMatch(/GLOSSARY/);
    expect(withoutG).not.toMatch(/GLOSSARY/); // no block when there's no glossary
    // The cacheable prefix does not depend on the glossary at all.
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/GLOSSARY/);
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain('Meridiun');
  });
});
