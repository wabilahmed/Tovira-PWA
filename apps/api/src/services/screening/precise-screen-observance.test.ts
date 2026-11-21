import { describe, it, expect } from 'vitest';
import { screenPrecise } from './precise-screen.js';
import { withholdSensitiveSentences } from '../import/dedup.js';
import { dropSensitiveSpans } from '../extraction/receipt-postcheck.js';
import type { Extraction } from '../extraction/types.js';

/**
 * [P83-7 · owner, 21 Nov] Pilgrimage and observance words join the precise list: Hajj, Umrah, fasting as an
 * observance, and Ramadan as an observance ("during Ramadan I'm observing"). Ramadan, Eid or Hajj used as a TIME
 * ANCHOR for a business step stays (P55-2 owner rule: holidays as dates are not sensitive). Whole words only.
 * Tovira only removes: the stored note is never rewritten, a flagged sentence is withheld from the model and a
 * flagged receipt quote is dropped.
 */
const N02 = "we're doing Umrah in February so we'll be away"; // accuracy key N02, verbatim: must not be stored
const religion = (t: string) => expect(screenPrecise(t).map((m) => m.category), t).toContain('religion');
const clear = (t: string) => expect(screenPrecise(t), t).toEqual([]);

describe('[P83-7] pilgrimage and observance are caught', () => {
  it('N02 verbatim is flagged as religion', () => religion(N02));
  it.each([
    'he is going for Hajj next month',
    'she performed Umrah last year',
    'they are on Hajj until the 20th',
    'my father just came back from umrah',
    'HAJJ this year for the whole family',
    "we're fasting for Ramadan",
    "during Ramadan I'm observing",
    'during Ramadan we are observing, so evenings only',
    'he is observing Ramadan',
  ])('"%s" is flagged', (t) => religion(t));
  it('N02 never reaches the model from a pasted note or voice transcript (the sentence is withheld)', () => {
    const text = `Spoke to Karim. ${N02}. He will send the documents by Friday.`;
    const safe = withholdSensitiveSentences(text);
    expect(safe).not.toMatch(/umrah/i);
    expect(safe).toContain('He will send the documents by Friday.');
    expect(safe).toContain('Spoke to Karim.');
  });
  it('N02 is never kept as a receipt quote (the fact keeps no quote of it)', () => {
    const ex: Extraction = {
      summary: '', promises: [], people: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null,
      personal_facts: [{ subject: 'Karim', fact: 'Away in February', category: 'travel', source_span: N02 }],
    };
    expect(dropSensitiveSpans(ex)).toBe(1);
    expect(ex.personal_facts[0]!.source_span).toBeNull();
  });
});

describe('[P83-7] NEGATIVE: business meaning and unrelated words are never cut', () => {
  it.each([
    "after Ramadan we'll sign",
    'before Ramadan we sign the lease',
    'Ramadan timings start Monday',
    'during Ramadan our office closes at 3',
    'after Hajj we can do the viewing',
    'post Umrah the prices go back down',
    'the Hajj season rush is over',
  ])('date use "%s" stays', (t) => clear(t));
  it.each([
    'he is fastidious about the paperwork',
    'fast delivery please',
    'we need a fast turnaround',
    'breakfast meeting at 8',
    'we are observing the market closely',
    'Umrahs', // not a word on the list: whole words only
    'hajji', // a different word
  ])('unrelated "%s" stays', (t) => clear(t));
  it('a flagged sentence is withheld, never reworded: the other sentences are kept word for word', () => {
    const text = "Viewing confirmed for Saturday. we're fasting for Ramadan. Bring the keys.";
    expect(withholdSensitiveSentences(text)).toBe('Viewing confirmed for Saturday. Bring the keys.');
  });
  it.each(['Umrah packages for 40 staff', 'send me the Hajj visa checklist', 'the Umrah tour operator called', 'two Hajj bookings for March'])(
    'the pilgrimage trade "%s" is business, not observance, and stays',
    (t) => clear(t),
  );
  it('a time anchor keeps the whole business sentence for the model', () => {
    const text = "after Ramadan we'll sign. Send the draft.";
    expect(withholdSensitiveSentences(text)).toBe(text);
  });
});
