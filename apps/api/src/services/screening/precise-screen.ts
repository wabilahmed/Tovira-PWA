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
 * [P83-7 · owner] Pilgrimage is observance too: "we're doing Umrah in February", "he is going for Hajj", and "during
 * Ramadan I'm observing"; "after Hajj we sign" is a date and the Umrah or Hajj trade ("Umrah packages") is business.
 *
 * KNOWN MISSES (precise-screen.test.ts records them): vague or indirect mentions ("he has been unwell", "trouble with
 * the police"), misspellings, and Arabic and Hindi beyond the common terms below.
 */
/** `statement`: the match is a statement about a person, never a date word, so the date check below does not apply. */
type Rule = { category: SensitiveCategory; re: RegExp; statement?: true };
const W = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'giu');
const CASED = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'gu');
const ANY = (words: string) => new RegExp(`(?:${words})`, 'gu'); // Arabic / Devanagari: letters attach (ال…), no \b

const FAITH = 'hindu|muslim|christian|sikh|jain|buddhist|jewish|catholic|atheist';
const PARTIES = 'labour|congress|bjp|aap|conservatives?|tory|tories|republicans?|democrats?|democratic|greens?|green|national|shiv sena';

const RULES: Rule[] = [
  { category: 'health', re: W('hepatitis|hiv|cancer|tumou?r|diabetes|diabetic|tuberculosis|chemo(?:therapy)?|dialysis|surgery|pregnan(?:t|cy)|miscarriage|depression|bipolar|schizophreni[ac]|autis(?:m|tic)|adhd|epilep(?:sy|tic)|asthma(?:tic)?|heart attack|disabilit(?:y|ies)|disabled (?:person|people|child|children|son|daughter|man|woman|employee|candidate|worker)|hospitali[sz]ed|admitted to (?:the )?hospital|mental health|tested positive|diagnosed|diagnosis|medical condition|on medication|infertil(?:e|ity)|ivf|chronic illness') },
  { category: 'health', re: CASED('AIDS') },
  { category: 'health', re: ANY('कैंसर|डायबिटीज|मधुमेह|गर्भवती|हेपेटाइटिस|अस्पताल में भर्ती|سرطان|سكري|حامل|التهاب الكبد') },
  { category: 'criminal', re: W('convicted|convictions?|criminal record|jail(?:ed)?|prison|imprisoned|arrested|under arrest|sentenced|police case|on bail|parole|charged with') },
  { category: 'criminal', re: CASED('FIR') },
  { category: 'criminal', re: ANY('जेल|गिरफ्तार|سجن|محكوم') },
  // [P55-2 · owner] a faith word counts only describing a person ("is Jain", "a practising Jain"), never as a name ("Rahul Jain")
  { category: 'religion', re: W(`(?:is|am|are|was|were|be|being|a|an|born|practising|practicing|devout|strict|observant|(?:is|am|are|was) (?:a|an)(?: (?:practising|practicing|devout|strict|observant))?) (?:${FAITH})|(?:is|am|are|was|very|quite|deeply|not) religious|devout|fasting|prays|praying|converted to`) },
  { category: 'religion', re: W('(?:observes|observing|celebrates|celebrating|keeps|keeping) (?:the )?(?:ramadan|ramzan|roza|eid|diwali|navratri|karwa chauth|lent|easter|christmas|passover|shabbat|sabbath)') },
  { category: 'religion', re: W('goes to (?:the )?(?:church|mosque|temple|gurdwara|synagogue)') },
  // [P83-7 · owner] pilgrimage: "we're doing Umrah in February", "he is going for Hajj". Not the trade in it ("Umrah
  // packages", "Hajj visa", "Umrah tour operator"), and not a date ("after Hajj", "the Hajj season": the date check).
  { category: 'religion', re: W('(?:hajj|umrah)(?!\\s+(?:packages?|visas?|tours?|operators?|agen(?:t|ts|cy|cies)|bookings?)\\b)') },
  // [P83-7 · owner] observance said with no object, ending the clause: "during Ramadan I'm observing".
  { category: 'religion', statement: true, re: W("(?:i['’]m|i am|we['’]re|we are|he['’]s|he is|she['’]s|she is|they['’]re|they are) observing(?=\\s*(?:[.,;:!?]|$))") },
  { category: 'religion', re: ANY('व्रत|रोज़ा|रोजा|صائم|يصوم') },
  // [P55-2 · owner] a party name counts only with party context (party, voted, votes, member, campaign, rally, ticket),
  // never "labour card", "Ministry of Labour", "conservative estimate", "green light" or "Democratic Republic of Congo"
  { category: 'political_opinion', re: W(`(?:votes?|voted|voting) for (?:the )?(?:[\\p{L}]+ ){0,2}(?:party|${PARTIES})|(?:${PARTIES}) (?:party|rally|ticket|member|members|campaign|candidate|worker)|(?:member|campaign(?:s|ed|ing)?|rally|ticket|works?) (?:of|for) (?:the )?(?:${PARTIES})|political (?:party|views|opinions?|rally|campaign)|party (?:member|worker|ticket)|campaign(?:s|ed|ing)? for (?:the )?(?:[\\p{L}]+ ){0,2}(?:party|candidate)`) },
  { category: 'ethnicity', re: W('caste|dalit|brahmin|ethnicity|tribal') }, // [P55-2] not bare "ethnic" ("ethnic wear")
  { category: 'sexual_life', re: W('gay|lesbian|bisexual|transgender|lgbtq?|homosexual|same-sex') },
];

// A religion word used as a date ("after the fasting month", "fasting season") is not an observance.
const DATE_BEFORE = /(?:^|\s)(?:after|before|post|pre|during|until|till|by|over|around|ahead of|from)\s+(?:the\s+)?(?:\S+\s+)?$/i;
const DATE_AFTER = /^\s*(?:break|holidays?|week|month|season|sale|offers?|rush|timings?|hours|period|days?)\b/i;
// [P83-7] "back from Umrah" is a trip the person made, not a date.
const RETURNED_FROM = /\b(?:back|returned|returning|home)\s+from\s+(?:the\s+|his\s+|her\s+|their\s+|our\s+|my\s+)?$/i;
function usedAsDate(text: string, index: number, span: string): boolean {
  if (RETURNED_FROM.test(text.slice(Math.max(0, index - 30), index))) return false;
  return DATE_BEFORE.test(text.slice(Math.max(0, index - 30), index)) || DATE_AFTER.test(text.slice(index + span.length, index + span.length + 20));
}

/** Every precise sensitive indicator in `text`: the category, the matched words and where. Never rewrites the text. */
export function screenPrecise(text: string): SensitiveMatch[] {
  if (!text) return [];
  const out: SensitiveMatch[] = [];
  for (const { category, re, statement } of RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (category === 'religion' && !statement && usedAsDate(text, m.index, m[0])) continue;
      out.push({ category, span: m[0], index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
