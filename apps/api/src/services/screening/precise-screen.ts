import type { SensitiveCategory, SensitiveMatch } from './sensitive-screen.js';

/**
 * [P55-2 · owner] The PRECISE sensitive list: what is withheld from the model automatically, with no human review, on
 * every capture path (chat imports, pasted notes, voice transcripts) and in receipts. It replaces the broad screen for
 * automatic withholding: the broad lexicon was built for human review ("back", "party", "court", "charged",
 * "operation", "church" all flag), and unreviewed it withheld ordinary sales content ("I'll call you back Friday").
 *
 * PRECISION FIRST: a term is listed only when it names the sensitive thing itself. A diagnosis or treatment, a
 * conviction or arrest, a personal statement of faith or observance, a vote, a party or campaigning for one, caste or
 * ethnicity, sexual orientation.
 *
 * HOLIDAYS AS DATES ARE NOT SENSITIVE (owner): "after Ramadan", "Eid break", "post Diwali", "during Ramadan", "Ramadan
 * timings" are dates. Festival names are not listed at all; only observance is ("he is fasting", "she observes
 * Ramadan", "he prays"), and even an observance word used as a date ("after the fasting month") is not withheld.
 *
 * KNOWN MISSES (precise-screen.test.ts records them): vague or indirect mentions ("he has been unwell", "trouble with
 * the police"), misspellings, and Arabic and Hindi beyond the common terms below.
 */
type Rule = { category: SensitiveCategory; re: RegExp };
const W = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'giu');
const CASED = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'gu');
const ANY = (words: string) => new RegExp(`(?:${words})`, 'gu'); // Arabic / Devanagari: letters attach (ال…), no \b

const RULES: Rule[] = [
  { category: 'health', re: W('hepatitis|hiv|cancer|tumou?r|diabetes|diabetic|tuberculosis|chemo(?:therapy)?|dialysis|surgery|pregnan(?:t|cy)|miscarriage|depression|bipolar|schizophreni[ac]|autis(?:m|tic)|adhd|epilep(?:sy|tic)|asthma(?:tic)?|heart attack|disabilit(?:y|ies)|disabled|hospitali[sz]ed|admitted to (?:the )?hospital|mental health|tested positive|diagnosed|diagnosis|medical condition|on medication|infertil(?:e|ity)|ivf|chronic illness') },
  { category: 'health', re: CASED('AIDS') },
  { category: 'health', re: ANY('कैंसर|डायबिटीज|मधुमेह|गर्भवती|हेपेटाइटिस|अस्पताल में भर्ती|سرطان|سكري|حامل|التهاب الكبد') },
  { category: 'criminal', re: W('convicted|convictions?|criminal record|jail(?:ed)?|prison|imprisoned|arrested|under arrest|sentenced|police case|on bail|parole|charged with') },
  { category: 'criminal', re: CASED('FIR') },
  { category: 'criminal', re: ANY('जेल|गिरफ्तार|سجن|محكوم') },
  { category: 'religion', re: W('hindu|muslim|christian|sikh|jain|buddhist|jewish|catholic|atheist|devout|religious|fasting|prays|praying|converted to') },
  { category: 'religion', re: W('(?:observes|observing|celebrates|celebrating|keeps|keeping) (?:the )?(?:ramadan|ramzan|roza|eid|diwali|navratri|karwa chauth|lent|easter|christmas|passover|shabbat|sabbath)') },
  { category: 'religion', re: W('goes to (?:the )?(?:church|mosque|temple|gurdwara|synagogue)') },
  { category: 'religion', re: ANY('व्रत|रोज़ा|रोजा|صائم|يصوم') },
  { category: 'political_opinion', re: W('(?:votes?|voted|voting) for (?:the )?(?:[\\p{L}]+ ){0,2}(?:party|labour|congress|bjp|conservatives|tories|republicans|democrats|greens)|political (?:party|views|opinions?|rally|campaign)|party (?:member|worker|ticket)|green party|labour party|conservative party|republican party|democratic party|national party|shiv sena|campaign(?:s|ed|ing)? for (?:the )?(?:[\\p{L}]+ ){0,2}(?:party|candidate)') },
  { category: 'political_opinion', re: CASED('BJP') },
  { category: 'ethnicity', re: W('caste|dalit|brahmin|ethnic|ethnicity|tribal') },
  { category: 'sexual_life', re: W('gay|lesbian|bisexual|transgender|lgbtq?|homosexual|same-sex') },
];

// A religion word used as a date ("after the fasting month", "fasting season") is not an observance.
const DATE_BEFORE = /(?:^|\s)(?:after|before|post|pre|during|until|till|by|over|around|ahead of|from)\s+(?:the\s+)?(?:\S+\s+)?$/i;
const DATE_AFTER = /^\s*(?:break|holidays?|week|month|season|sale|offers?|rush|timings?|hours|period|days?)\b/i;
function usedAsDate(text: string, index: number, span: string): boolean {
  return DATE_BEFORE.test(text.slice(Math.max(0, index - 30), index)) || DATE_AFTER.test(text.slice(index + span.length, index + span.length + 20));
}

/** Every precise sensitive indicator in `text`: the category, the matched words and where. Never rewrites the text. */
export function screenPrecise(text: string): SensitiveMatch[] {
  if (!text) return [];
  const out: SensitiveMatch[] = [];
  for (const { category, re } of RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (category === 'religion' && usedAsDate(text, m.index, m[0])) continue;
      out.push({ category, span: m[0], index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
