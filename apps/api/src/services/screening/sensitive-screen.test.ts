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

describe('[SCREEN] health/term inflections and compounds are caught (whole-word-only gap fix)', () => {
  // The lexicon used to match only the exact base word, so "chemo" was flagged but "chemotherapy" was
  // not — a MISS that sent special-category data to the model. Each base term must now catch its common
  // inflections and compounds. These are the extended forms, grouped by the stem that must catch them.
  const CAUGHT: Record<SensitiveCategory, string[]> = {
    health: [
      'he starts chemotherapy next week', 'he is diabetic now', 'her pregnancy is going well',
      'two pregnancies in three years', 'the tumour is cancerous', 'he was diagnosed on Tuesday',
      'she sees a therapist weekly', 'the medical report is attached', 'he has been anxious lately',
      'he seemed very depressed', 'multiple injuries from the fall', 'the doctor prescribed rest',
      'he is diseased', 'the apartment has disabilities access needs noted', 'a bout of sickness',
    ],
    religion: [
      'he converted to Christianity', 'the Muslims in the building', 'raised in Hinduism',
      'he practises Buddhism', 'the baby was baptized', 'the pilgrims return next week', 'their daily prayers',
    ],
    ethnicity: [
      'three Pakistanis on the crew', 'the Filipinos who cleaned', 'several Egyptians applied',
      'his immigration status', 'a question of ethnicity', 'the expatriates on the floor',
    ],
    political_opinion: [
      'the voters turned out', 'the new governor spoke', 'two ministers attended', 'a democratic process',
      'accused of communism', 'he is a politician', 'the goods were sanctioned', 'they are boycotting the mall',
      'years of activism',
    ],
    criminal: [
      'three arrests last month', 'the prisoner was moved', 'a policeman came by', 'the claim was fraudulent',
      'his prior convictions', 'a known smuggler', 'he was prosecuted', 'facing deportation', 'he kept absconding',
    ],
    sexual_life: [
      'the lesbians next door', 'two bisexuals in the group', 'accused of adultery', 'questions about his sexuality',
      'he kept a mistress for years', 'transgenders were welcomed',
    ],
  };
  for (const category of SENSITIVE_CATEGORIES) {
    for (const text of CAUGHT[category]) {
      it(`${category}: flags "${text}"`, () => expect(catsOf(text)).toContain(category));
    }
  }
});

describe('[SCREEN] inflection matching does NOT catch unrelated words that merely share a prefix', () => {
  // The whole-word-only fix must widen matching to inflections WITHOUT bleeding into ordinary business /
  // real-estate words that happen to start the same way. Each of these must produce ZERO matches.
  const CLEAN = [
    'a chemical smell in unit 7', 'the diabolo set in the playroom', 'see our privacy policy',
    'review the building policies', 'such a friendly community', 'clear communication throughout',
    'my business partner is in', 'sign the partnership agreement', 'an electric car charger',
    'the electricity bill is high', 'send the bank transfer today', 'the transaction has closed',
    'five-star hospitality on site', 'a villa with a courtyard', 'inside a conservation area',
    "let's socialise after the viewing", 'a villa in Arabian Ranches', 'we pay tribute to the founder',
    'the matter went to tribunal', 'a shop selling gold jewelry', 'twenty acres of pastoral land',
    'a restored medieval castle', 'the administration office upstairs', 'a weekend activity for kids',
    'this layout liberates the space',
  ];
  for (const text of CLEAN) {
    it(`clean: "${text}"`, () => expect(screenSensitive(text)).toEqual([]));
  }
});

describe('[SCREEN] shape', () => {
  it('exposes all six categories', () => {
    expect(new Set(SENSITIVE_CATEGORIES)).toEqual(new Set(['health', 'religion', 'ethnicity', 'political_opinion', 'criminal', 'sexual_life']));
  });
  it('a clean message produces no matches', () => {
    expect(screenSensitive('can you send the floor plan and the price for unit 12')).toEqual([]);
  });
});
