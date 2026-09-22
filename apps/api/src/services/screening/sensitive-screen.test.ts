import { describe, it, expect } from 'vitest';
import { screenSensitive, SENSITIVE_CATEGORIES, type SensitiveCategory } from './sensitive-screen.js';

/**
 * [SCREEN] The pre-send sensitive detector: deterministic (NO model call), per-category, recall-tuned.
 * A human reviews every flag, so a false flag costs one glance; a miss sends sensitive data to an
 * external model. These tests therefore assert that KNOWN benign cases are still flagged — over-flagging
 * is the intended behaviour, not a bug to be silenced.
 */
const catsOf = (text: string): Set<SensitiveCategory> => new Set(screenSensitive(text).map((m) => m.category));

describe('[SCREEN] sensitive detector — clear cases per category (English)', () => {
  it('health', () => expect(catsOf('he is in hospital after his surgery')).toContain('health'));
  it('religion', () => expect(catsOf('we broke fast during Ramadan at the mosque')).toContain('religion'));
  it('ethnicity', () => expect(catsOf('he is Pakistani, only just moved here')).toContain('ethnicity'));
  it('political_opinion', () => expect(catsOf('she backs the opposition and voted against the government')).toContain('political_opinion'));
  it('criminal', () => expect(catsOf('he was arrested last year and is out on bail')).toContain('criminal'));
  it('sexual_life', () => expect(catsOf('he is gay and recently came out to his family')).toContain('sexual_life'));
});

describe('[SCREEN] Arabic-script and transliterated indicators', () => {
  it('detects Arabic-script health/religion', () => {
    expect(catsOf('هو في المستشفى بعد العملية')).toContain('health'); // mustashfa (hospital) + 3amaliya (operation)
    expect(catsOf('صلاة الجمعة في المسجد')).toContain('religion'); // salah + masjid
  });
  it('detects transliterated (Arabizi) indicators', () => {
    expect(catsOf('rayeh el mustashfa bacher')).toContain('health'); // hospital, transliterated
    expect(catsOf('mabrouk 3al 3amaliya')).toContain('health'); // operation, transliterated
  });
});

describe('[SCREEN] span, category, and never altering the message', () => {
  it('returns the matched span located in the original text', () => {
    const text = 'He had an operation last week.';
    const matches = screenSensitive(text);
    const m = matches.find((x) => x.category === 'health');
    expect(m).toBeTruthy();
    expect(m!.span.toLowerCase()).toBe('operation');
    expect(text.slice(m!.index, m!.index + m!.span.length)).toBe(m!.span); // the index+span locate the real substring
  });

  it('never rewrites or alters the message — it only reports matches', () => {
    const text = 'He had an operation; his party votes against the government.';
    const before = text;
    const matches = screenSensitive(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(text).toBe(before); // input string object untouched
    // screenSensitive returns matches, not a string — there is no rewritten output to diverge.
    expect(Array.isArray(matches)).toBe(true);
  });
});

describe('[SCREEN] over-flagging is INTENDED — benign cases are flagged, not silently passed', () => {
  // These are false positives by meaning. The detector flags them ON PURPOSE (recall over precision):
  // a rep glances and restores. The test asserts they are flagged so nobody "fixes" the over-flag later.
  it('flags a social "party" as political_opinion', () => expect(catsOf('the party is on Friday, bring the family')).toContain('political_opinion'));
  it('flags "back" (sore back / call back) as health', () => expect(catsOf('my back is killing me today')).toContain('health'));
  it('flags "court" (tennis court) as criminal', () => expect(catsOf('meet me at the tennis court at six')).toContain('criminal'));
  it('flags nationality-as-logistics as ethnicity', () => expect(catsOf('still waiting on his Indian visa paperwork')).toContain('ethnicity'));
  it('flags "church" (building/landmark) as religion', () => expect(catsOf('the villa near the church')).toContain('religion'));
});

describe('[SCREEN] shape', () => {
  it('exposes all six categories', () => {
    expect(new Set(SENSITIVE_CATEGORIES)).toEqual(new Set(['health', 'religion', 'ethnicity', 'political_opinion', 'criminal', 'sexual_life']));
  });
  it('a clean message produces no matches', () => {
    expect(screenSensitive('can you send the floor plan and the price for unit 12')).toEqual([]);
  });
});
