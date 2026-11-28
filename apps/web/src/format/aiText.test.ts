import { describe, it, expect } from 'vitest';
import { aiText } from './aiText.js';

/**
 * [P46-4] Owner: model-written lines (pointers, briefs, summaries, promise wording) still carried em-dashes
 * ("July — anchor the next…"). They are normalised at DISPLAY time, never in storage, and never in a receipt (a
 * receipt is the client's words, verbatim). A full clause after the dash starts a sentence; a short tail takes a comma.
 */
describe('[P46-4] aiText', () => {
  it('" — " before a full clause becomes ". " with a capital', () => {
    expect(aiText('Budget approved for July — anchor the next meeting on the payment plan')).toBe('Budget approved for July. Anchor the next meeting on the payment plan');
  });
  it('" — " before a short tail becomes ", "', () => {
    expect(aiText('Wants a villa — ideally Mirdif')).toBe('Wants a villa, ideally Mirdif');
  });
  it('a paired aside becomes commas', () => {
    expect(aiText('Her husband — the decision maker — prefers calls')).toBe('Her husband, the decision maker, prefers calls');
  });
  it('a dash with no spaces, a trailing dash and a leading dash', () => {
    expect(aiText('Send the plans—today')).toBe('Send the plans, today');
    expect(aiText('Follow up on the deposit —')).toBe('Follow up on the deposit.');
    expect(aiText('— Call her back')).toBe('Call her back');
  });
  it('keeps what it already did: ISO dates read as dates', () => {
    expect(aiText('Viewing (for 2026-04-06) — bring the keys and the parking card')).toBe('Viewing (for 6 Apr 2026). Bring the keys and the parking card');
  });
  it('NEGATIVE: text without an em-dash is unchanged, and an en dash range stays', () => {
    expect(aiText('Budget AED 2–3M, two bedrooms')).toBe('Budget AED 2–3M, two bedrooms');
    expect(aiText('')).toBe('');
  });
});

// [P90-4 · owner, Prompt 88] The pre-meeting brief crashed on a stored concern that was an object, not text.
describe('[P90-4] aiText and a value that is not text', () => {
  it('NEGATIVE: an object, null or a number shows as nothing and never throws', () => {
    for (const v of [{ text: 'x' }, null, undefined, 7, ['a']]) expect(aiText(v as unknown as string)).toBe('');
  });
  it('text is unchanged', () => { expect(aiText('Timeline is tight')).toBe('Timeline is tight'); });
});
