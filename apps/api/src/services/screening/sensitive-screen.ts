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
 * Per category: `latin` terms are matched with word boundaries and case-insensitively; `script` terms
 * (Arabic) are matched as substrings, because JS `\b` does not behave on non-ASCII letters — so an
 * Arabic term is found even with an attached article (العملية contains عملية). Arabizi transliterations
 * live in `latin` (they are ASCII).
 */
const LEXICON: Record<SensitiveCategory, { latin: string[]; script: string[] }> = {
  health: {
    latin: ['hospital', 'surgery', 'operation', 'sick', 'ill', 'illness', 'disease', 'doctor', 'clinic',
      'medicine', 'medication', 'treatment', 'cancer', 'diabetes', 'diagnosis', 'therapy', 'depression',
      'anxiety', 'pregnant', 'pregnancy', 'injury', 'injured', 'disability', 'disabled', 'prescription',
      'pain', 'back', 'chemo', 'covid', 'stroke', 'heart attack', 'blood pressure',
      // Arabizi
      'mustashfa', 'mareed', '3amaliya', 'dawa', '3ilaj', 'doktor'],
    script: ['مستشفى', 'عملية', 'مريض', 'طبيب', 'دكتور', 'دواء', 'علاج', 'سرطان', 'حامل', 'مرض'],
  },
  religion: {
    latin: ['church', 'mosque', 'temple', 'synagogue', 'prayer', 'praying', 'Ramadan', 'Eid', 'Diwali',
      'Quran', 'Koran', 'Bible', 'Torah', 'halal', 'haram', 'fasting', 'Hajj', 'Umrah', 'pilgrimage',
      'Christian', 'Muslim', 'Hindu', 'Jewish', 'Sikh', 'Buddhist', 'Catholic', 'baptism', 'pastor',
      'imam', 'priest',
      // Arabizi
      'salah', 'salat', 'jumaa', 'jumua', 'masjid', 'kaneesa'],
    script: ['صلاة', 'مسجد', 'جمعة', 'رمضان', 'عيد', 'حلال', 'حرام', 'كنيسة', 'مسيحي', 'مسلم', 'صيام'],
  },
  ethnicity: {
    latin: ['Indian', 'Pakistani', 'Filipino', 'Filipina', 'Bangladeshi', 'Nepali', 'Sri Lankan', 'Egyptian',
      'Emirati', 'Syrian', 'Lebanese', 'Jordanian', 'Palestinian', 'Iraqi', 'Iranian', 'Sudanese', 'Yemeni',
      'Kerala', 'Punjabi', 'Arab', 'African', 'Asian', 'European', 'Western', 'tribe', 'tribal', 'caste',
      'ethnic', 'expat', 'expatriate', 'immigrant'],
    script: ['هندي', 'باكستاني', 'فلبيني', 'مصري', 'سوري', 'لبناني', 'عربي', 'قبيلة', 'بدون'],
  },
  political_opinion: {
    latin: ['party', 'vote', 'voted', 'voting', 'election', 'government', 'opposition', 'protest', 'regime',
      'minister', 'democracy', 'communist', 'socialist', 'liberal', 'conservative', 'politics', 'political',
      'sanctions', 'boycott', 'activist'],
    script: ['حزب', 'انتخابات', 'حكومة', 'وزير', 'معارضة', 'سياسة', 'مقاطعة'],
  },
  criminal: {
    latin: ['arrest', 'arrested', 'jail', 'jailed', 'prison', 'police', 'court', 'crime', 'criminal', 'fraud',
      'theft', 'stolen', 'lawsuit', 'sued', 'convicted', 'conviction', 'charged', 'bail', 'offence', 'offense',
      'illegal', 'smuggling', 'drugs', 'prosecution', 'custody', 'deported', 'deportation', 'absconded'],
    script: ['شرطة', 'سجن', 'محكمة', 'قضية', 'مخدرات', 'جريمة', 'اعتقال'],
  },
  sexual_life: {
    latin: ['gay', 'lesbian', 'bisexual', 'LGBT', 'LGBTQ', 'queer', 'transgender', 'trans', 'mistress',
      'affair', 'adultery', 'sexual', 'sexuality', 'orientation'],
    script: ['مثلي', 'زنا', 'عشيقة'],
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled once per category: a word-bounded case-insensitive Latin regex and a substring script regex. */
const COMPILED: Array<{ category: SensitiveCategory; latin: RegExp | null; script: RegExp | null }> = SENSITIVE_CATEGORIES.map((category) => {
  const { latin, script } = LEXICON[category];
  return {
    category,
    latin: latin.length ? new RegExp(`\\b(?:${latin.map(escapeRegExp).join('|')})\\b`, 'gi') : null,
    script: script.length ? new RegExp(`(?:${script.map(escapeRegExp).join('|')})`, 'g') : null,
  };
});

/**
 * Scan `text` and return every sensitive indicator found, each with its category, the exact matched span,
 * and its start index in `text`. Returns [] for a clean message. NEVER modifies `text`.
 */
export function screenSensitive(text: string): SensitiveMatch[] {
  if (!text) return [];
  const out: SensitiveMatch[] = [];
  for (const { category, latin, script } of COMPILED) {
    for (const re of [latin, script]) {
      if (!re) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push({ category, span: m[0], index: m.index });
        if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match looping
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
