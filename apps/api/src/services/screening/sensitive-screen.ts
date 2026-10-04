/**
 * [SCREEN] Pre-send sensitive-content detector. DETERMINISTIC — no model call (screening by model would
 * defeat the purpose: the model send is exactly what this gates). It scans a message for indicators of
 * special-category data and returns the matched spans, grouped by category, for a human to review. It
 * NEVER rewrites the message.
 *
 * TUNING — RECALL OVER PRECISION (derivation). A human reviews every flag before anything is sent, so:
 *   • a FALSE flag costs one glance and a click to restore;
 *   • a MISS sends special-category data to an external model, irreversibly.
 * The costs are asymmetric, so the lexicons are deliberately broad and WILL over-flag. Known, accepted
 * over-flags (each an ordinary business word that also indicates a category):
 *   • health:    "back" (sore back / "call you back"), "operation", "treatment", "pain"
 *   • religion:  "church" (a landmark/building), "temple", "fasting"
 *   • ethnicity: nationality-as-logistics ("his Indian visa", "the Filipino agent")
 *   • political: "party" (a social event), "minister"
 *   • criminal:  "court" (tennis/basketball court), "charged" (a fee), "case" (luggage/matter)
 *   • sexual:    "affair" (a business affair)
 * These are flagged on purpose; the review restores them. Do NOT "fix" them to raise precision — the
 * test suite asserts several of them stay flagged.
 *
 * DELIBERATE PRECISION CARVE-OUTS (recorded so the recall claim is honest, not silent):
 *   • Ubiquitous interjections — "inshallah", "mashallah", "alhamdulillah", "wallah" — are NOT in the
 *     religion lexicon. They appear in a large fraction of UAE messages as cultural filler, not as a
 *     statement about a person's religion; flagging them would flag most messages and make review
 *     useless (it would de-facto block all imports). This is a recall loss on those exact tokens,
 *     traded for a usable review. Revisit if counsel wants them in.
 *   • "relationship" and bare "fast" are excluded (sexual_life / religion) for the same reason — they
 *     saturate ordinary sales chat. "relationship status", "fasting", "Ramadan" still catch the register.
 *
 * ARABIC / TRANSLITERATION COVERAGE — REPORTED HONESTLY. The UAE market code-switches, so an English-only
 * detector would miss most of the register. This module carries a STARTER lexicon of common Modern
 * Standard Arabic script terms and common Arabizi transliterations (e.g. "mustashfa", "3amaliya"). It is
 * NOT exhaustive: transliteration is unstandardised (mareed/mareeth/mريض), dialect varies (Gulf/Levantine/
 * Egyptian), and coverage is strongest for health/religion, thinner for political/criminal, and weakest
 * for sexual_life. Treat Arabic coverage as "common terms caught, long tail missed" — do not claim more.
 */

export type SensitiveCategory = 'health' | 'religion' | 'ethnicity' | 'political_opinion' | 'criminal' | 'sexual_life';

export const SENSITIVE_CATEGORIES: SensitiveCategory[] = ['health', 'religion', 'ethnicity', 'political_opinion', 'criminal', 'sexual_life'];

/** One flagged span: the category, the exact substring matched, and where it starts in the message. */
export interface SensitiveMatch {
  category: SensitiveCategory;
  span: string;
  index: number;
}

/**
 * Per category, three kinds of term:
 *   • `latin`  — matched with BOTH word boundaries, case-insensitively: the exact word only (`\bword\b`).
 *                Used for terms whose inflections would collide with ordinary words if stemmed
 *                (e.g. "ill" → illegal, "trans" → transfer, "party" → partner, "court" → courtyard).
 *                Arabizi transliterations live here too (they are ASCII).
 *   • `stems`  — matched with a LEADING boundary + a trailing word-char run (`\bstem\w*`), so the stem's
 *                common inflections and compounds are caught: "chemo" → chemotherapy, "diabet" →
 *                diabetes/diabetic, "pregnan" → pregnant/pregnancy/pregnancies. Each stem is chosen so no
 *                ordinary business/real-estate word merely SHARES its prefix (verified by the clean-set
 *                tests): e.g. "chemo" ≠ chemical, "diabet" ≠ diabolo, "police" ≠ policy, "communis" ≠
 *                community, "caste" ≠ castle, "minist" ≠ administration, "activis" ≠ activity. See the
 *                audit note in the batch report for every stem and why it is safe.
 *   • `suffixes` — matched with a trailing boundary and any leading word chars (`\b\w*suffix\b`), so
 *                COMPOUNDS ending in a sensitive root are caught regardless of the prefix: "therapy" →
 *                physiotherapy, psychotherapy, hydrotherapy, radiotherapy. Only health uses it today.
 *   • `script` — Arabic, matched as a SUBSTRING (JS `\b` does not behave on non-ASCII letters), so an
 *                Arabic term is found even with an attached article (العملية contains عملية).
 *
 * A match may still be dropped by EXCLUSIONS (below) when the matched word sits in a known benign
 * compound — an amenity, a landmark or a market descriptor — so the stems stay broad for real signals
 * ("medical report", "the government") while the Dubai real-estate register ("medical centre",
 * "government fee") stops over-flagging.
 */
const LEXICON: Record<SensitiveCategory, { latin: string[]; stems: string[]; suffixes?: string[]; script: string[] }> = {
  health: {
    // kept exact (inflection would collide): ill/illness (illegal, illustrate), back (backyard),
    // operation (operations=business), treatment (treaty/treat), surgery (surge/surging=price surge),
    // hospital (hospitality), doctor (doctoral), clinic.
    latin: ['hospital', 'surgery', 'operation', 'ill', 'illness', 'doctor', 'clinic', 'treatment',
      'pain', 'back', 'covid', 'stroke', 'heart attack', 'blood pressure',
      // Arabizi
      'mustashfa', 'mareed', '3amaliya', 'dawa', '3ilaj', 'doktor'],
    stems: ['chemo', 'diabet', 'pregnan', 'cancer', 'diagnos', 'therap', 'medic', 'anxi', 'depress',
      'injur', 'prescri', 'disease', 'disab', 'sick'],
    // -therapy compounds (physiotherapy, psychotherapy, hydrotherapy, radiotherapy, chemotherapy). The
    // "aromatherapy" spa amenity that this also matches is dropped by EXCLUSIONS.
    suffixes: ['therapy', 'therapies', 'therapist', 'therapists'],
    script: ['مستشفى', 'عملية', 'مريض', 'طبيب', 'دكتور', 'دواء', 'علاج', 'سرطان', 'حامل', 'مرض'],
  },
  religion: {
    // kept exact: pastor (pastoral land), Jewish (Jew → jewelry), fasting (deliberate: not "fast").
    // "pray/prays/prayed/praying/prayers" are EXACT (not a `pray` stem) so singular "prayer" is NOT
    // matched — "prayer room/rug/time/hall" are UAE building amenities; personal practice reads as
    // praying/prayers.
    latin: ['Ramadan', 'Eid', 'Diwali', 'Quran', 'Koran', 'Bible', 'Torah', 'halal', 'haram', 'fasting',
      'Hajj', 'Umrah', 'Jewish', 'pastor', 'pray', 'prays', 'prayed', 'praying', 'prayers',
      // Arabizi
      'salah', 'salat', 'jumaa', 'jumua', 'masjid', 'kaneesa'],
    stems: ['christian', 'muslim', 'hindu', 'sikh', 'buddh', 'catholic', 'bapti', 'pilgrim',
      'mosque', 'synagogue', 'church', 'temple', 'imam', 'priest'],
    script: ['صلاة', 'مسجد', 'جمعة', 'رمضان', 'عيد', 'حلال', 'حرام', 'كنيسة', 'مسيحي', 'مسلم', 'صيام'],
  },
  ethnicity: {
    // kept exact: Arab (Arabian Ranches), tribe/tribal (tribute/tribunal), Western (western-facing),
    // Kerala, Sri Lankan (multiword). "immigrant/immigrants" are EXACT (not an `immigra` stem) so
    // "immigration" (the golden-visa process) is not matched, but a person's immigrant status is.
    latin: ['Sri Lankan', 'Kerala', 'Arab', 'Arabs', 'Western', 'tribe', 'tribal', 'tribes',
      'expatriate', 'expatriates', 'immigrant', 'immigrants'],
    stems: ['indian', 'pakistani', 'filipin', 'bangladeshi', 'nepali', 'egyptian', 'syrian', 'lebanese',
      'jordanian', 'palestinian', 'iraqi', 'iranian', 'sudanese', 'yemeni', 'punjabi', 'emirati',
      'ethnic', 'expat', 'caste', 'african', 'asian', 'european'],
    script: ['هندي', 'باكستاني', 'فلبيني', 'مصري', 'سوري', 'لبناني', 'عربي', 'قبيلة', 'بدون'],
  },
  political_opinion: {
    // kept exact: party (partner/partnership), election (electric/electronic), socialist/socialism
    // (socialise), conservative (conservation), regime (regimen/regiment), protest (Protestant),
    // opposition. "sanctions" is EXACT (not a `sanction` stem) so the banking verb "sanctioned [a loan]"
    // (= approved) is not matched; economic/political sanctions are the plural noun.
    latin: ['party', 'parties', 'election', 'elections', 'electoral', 'opposition', 'protest', 'protests',
      'protester', 'regime', 'regimes', 'socialist', 'socialism', 'conservative', 'conservatives', 'sanctions'],
    stems: ['vot', 'govern', 'minist', 'democra', 'communis', 'liberal', 'politic', 'boycott',
      'activis'],
    script: ['حزب', 'انتخابات', 'حكومة', 'وزير', 'معارضة', 'سياسة', 'مقاطعة'],
  },
  criminal: {
    // kept exact: court (courtyard/courthouse), charged (a fee), bail (name), custody (custodian),
    // crime/criminal (crimson/Crimea), stolen, sued, offence/offense.
    latin: ['court', 'crime', 'crimes', 'criminal', 'stolen', 'sued', 'charged', 'bail', 'offence',
      'offences', 'offense', 'offenses', 'custody'],
    stems: ['arrest', 'jail', 'prison', 'police', 'fraud', 'theft', 'lawsuit', 'convict', 'illegal',
      'smuggl', 'drug', 'prosecut', 'deport', 'abscond'],
    script: ['شرطة', 'سجن', 'محكمة', 'قضية', 'مخدرات', 'جريمة', 'اعتقال'],
  },
  sexual_life: {
    // kept exact: gay (names), trans (transfer/transaction/transit), queer, LGBT/LGBTQ, orientation
    // (building orientation).
    latin: ['gay', 'gays', 'LGBT', 'LGBTQ', 'queer', 'trans', 'orientation'],
    stems: ['lesbian', 'bisexual', 'mistress', 'adulter', 'sexual', 'transgender', 'affair'],
    script: ['مثلي', 'زنا', 'عشيقة'],
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiled once per category: an exact word-bounded Latin regex (`\bword\b`), a stem regex matching a
 * stem plus trailing word chars (`\bstem\w*`), a suffix regex matching any word ENDING in a root
 * (`\b\w*suffix\b`), and a substring script regex. All case-insensitive except script (no case in Arabic).
 */
const COMPILED: Array<{ category: SensitiveCategory; latin: RegExp | null; stem: RegExp | null; suffix: RegExp | null; script: RegExp | null }> = SENSITIVE_CATEGORIES.map((category) => {
  const { latin, stems, suffixes, script } = LEXICON[category];
  return {
    category,
    latin: latin.length ? new RegExp(`\\b(?:${latin.map(escapeRegExp).join('|')})\\b`, 'gi') : null,
    stem: stems.length ? new RegExp(`\\b(?:${stems.map(escapeRegExp).join('|')})\\w*`, 'gi') : null,
    suffix: suffixes && suffixes.length ? new RegExp(`\\b\\w*(?:${suffixes.map(escapeRegExp).join('|')})\\b`, 'gi') : null,
    script: script.length ? new RegExp(`(?:${script.map(escapeRegExp).join('|')})`, 'g') : null,
  };
});

/**
 * EXCLUSIONS — a match is dropped when the matched word sits in a benign compound (an amenity, landmark
 * or market descriptor) that is NOT a statement about a person. Each pattern is anchored at the match
 * start (`^` tested against text.slice(index)) and applies only to the listed categories. This keeps the
 * stems broad for genuine signals ("medical report", "voted against the government") while the routine
 * Dubai real-estate register stops over-flagging. Every entry carries the reason it is safe to drop.
 */
const EXCLUSIONS: Array<{ cats: SensitiveCategory[]; re: RegExp; why: string }> = [
  // "government fee/service/transfer/department" = administration, not an opinion about the state.
  { cats: ['political_opinion'], re: /^government\s+(fee|fees|service|services|transfer|transfers|department|departments|portal|charge|charges|entity|entities|office|offices|approval|approvals)\b/i, why: 'government + an admin noun is a fee/service, not a political opinion' },
  // "medical centre/complex/clinic" = a building amenity, not a health condition.
  { cats: ['health'], re: /^medical\s+(cent(re|er)s?|complex(es)?|clinics?|facilit(y|ies)|buildings?|towers?|districts?)\b/i, why: 'a medical centre/complex is a building amenity, not a health condition of the client' },
  // aromatherapy = a spa amenity (the -therapy suffix would otherwise catch it).
  { cats: ['health'], re: /^aromatherap(y|ies|ist|ists)\b/i, why: 'aromatherapy is a spa amenity, not a medical treatment of the client' },
  // nationality/region + school/market/amenity noun = a landmark or demographic descriptor, not a person.
  { cats: ['ethnicity'], re: /^(indian|pakistani|filipin\w*|bangladeshi|nepali|egyptian|syrian|lebanese|jordanian|palestinian|iraqi|iranian|sudanese|yemeni|punjabi|emirati|african|asian|european)\s*-?\s*(schools?|restaurants?|cuisine|buyers?|clients?|investors?|tenants?|sellers?|markets?|communit(y|ies)|maids?|drivers?|embass(y|ies)|consulates?|associations?|clubs?)\b/i, why: 'a nationality before a school/market/amenity noun is a landmark or market segment, not a statement about an individual' },
  // "expat-friendly / expat community / expat area" = a listing descriptor; a person's status is "expatriate".
  { cats: ['ethnicity'], re: /^expat\s*-?\s*(friendly|communit(y|ies)|areas?|famil(y|ies)|life|living|crowd|hub|zone|neighbou?rhoods?)\b/i, why: 'expat-friendly/community/area is a listing descriptor, not a person\'s status' },
  // place of worship + a landmark noun = a location (a Dubai roundabout/road/tower), not a belief.
  { cats: ['religion'], re: /^(church|temple|mosque|synagogue)\s+(roundabouts?|roads?|streets?|towers?|buildings?|malls?|metro|stations?|areas?|districts?|signals?|junctions?|bridges?|views?|residences?|gardens?)\b/i, why: 'a place of worship + a landmark noun is a location, not a statement about belief' },
];

/** True when `match` sits inside a benign compound for its category (so it should be dropped). */
function isExcluded(text: string, match: SensitiveMatch): boolean {
  const tail = text.slice(match.index);
  return EXCLUSIONS.some((x) => x.cats.includes(match.category) && x.re.test(tail));
}

/**
 * Scan `text` and return every sensitive indicator found, each with its category, the exact matched span,
 * and its start index in `text`. Returns [] for a clean message. NEVER modifies `text`.
 */
export function screenSensitive(text: string): SensitiveMatch[] {
  if (!text) return [];
  const out: SensitiveMatch[] = [];
  for (const { category, latin, stem, suffix, script } of COMPILED) {
    for (const re of [latin, stem, suffix, script]) {
      if (!re) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const match = { category, span: m[0], index: m.index };
        if (!isExcluded(text, match)) out.push(match); // drop amenity/landmark/market compounds
        if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match looping
      }
    }
  }
  // A stem and its exact-word twin (e.g. latin "disease" and stem "disease") both match the same span.
  // Drop any match whose text range is fully contained within a longer same-category match, and collapse
  // identical same-category ranges to one, so each indicator is reported once (the longest span wins).
  const kept = out.filter((m, i) => !out.some((o, j) => {
    if (j === i || o.category !== m.category) return false;
    const covers = o.index <= m.index && o.index + o.span.length >= m.index + m.span.length;
    if (!covers) return false;
    return o.span.length > m.span.length || (o.span.length === m.span.length && j < i);
  }));
  return kept.sort((a, b) => a.index - b.index);
}
