import { normalizeName } from '../text/normalize-name.js';

/**
 * [P21-A1] Deterministic content-word matching between an Ask question and a stored fact, in English
 * and Arabic. No model, no translation: both sides are folded with the shared name normaliser (case,
 * diacritics, Arabic letter forms), function words dropped, and each word lightly stemmed (English
 * plural/-ing/-ed; Arabic leading article/clitic "ال/بال/وال/لل…") so "parking" meets "parking",
 * "cars" meets "car" and "بالمدارس" meets "المدارس". A false match only promotes a real, receipted fact
 * into the excerpts — it never invents one — so this leans towards recall.
 */

// Question scaffolding and generic verbs that would otherwise match nearly every row.
const STOP = new Set([
  // English
  'who', 'what', 'which', 'whose', 'whom', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'be', 'been',
  'am', 'do', 'does', 'did', 'have', 'has', 'had', 'i', 'me', 'my', 'mine', 'ive', 'we', 'our', 'us', 'you', 'your',
  'they', 'them', 'their', 'those', 'these', 'this', 'that', 'there', 'here', 'the', 'a', 'an', 'and', 'or', 'but',
  'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'about', 'any', 'all', 'some', 'anyone', 'anybody',
  'everyone', 'someone', 'client', 'clients', 'customer', 'customers', 'person', 'people', 'ask', 'asked', 'asks',
  'asking', 'question', 'questions', 'want', 'wanted', 'wants', 'need', 'needed', 'needs', 'say', 'said', 'tell',
  'told', 'mention', 'mentioned', 'talk', 'talked', 'like', 'liked', 'interested', 'look', 'looking', 'promise',
  'promised', 'promises', 'it', 'its', 'not', 'no', 'yes', 'can', 'could', 'would', 'should', 'will', 'also',
  'still', 'yet', 'ever', 'again', 'now', 'then', 'just', 'only', 'more', 'most', 'much', 'many', 'few', 'same',
  'other', 'others', 'one', 'ones', 'so', 'if', 'get', 'got', 'please', 'know', 'remind',
  // Arabic (already letter-folded by normalizeName: أ/إ/آ→ا, ى→ي, ة→ه)
  'من', 'مين', 'ما', 'ماذا', 'شو', 'ايش', 'هل', 'عن', 'في', 'على', 'الي', 'الى', 'التي', 'الذي', 'اللي', 'كل', 'مع',
  'هو', 'هي', 'هم', 'هما', 'او', 'و', 'لي', 'انا', 'نحن', 'انت', 'سال', 'يسال', 'طلب', 'يريد', 'عميل', 'عملاء',
]);

const ARABIC = /\p{Script=Arabic}/u;
// Leading Arabic clitic + article combinations, longest first.
const AR_PREFIXES = ['وبال', 'وال', 'بال', 'كال', 'فال', 'لل', 'ال'];

function stem(tok: string): string {
  if (ARABIC.test(tok)) {
    for (const p of AR_PREFIXES) if (tok.startsWith(p) && tok.length - p.length >= 3) return tok.slice(p.length);
    return tok;
  }
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (tok.endsWith(suf) && tok.length - suf.length >= 3) return tok.slice(0, -suf.length);
  }
  return tok;
}

function words(text: string): string[] {
  return normalizeName(text).split(' ').filter((t) => t.length >= 2 && !STOP.has(t));
}

/** The question's content terms (stemmed, de-duplicated). Empty when it has none. */
export function queryTerms(question: string): string[] {
  return [...new Set(words(question).map(stem).filter((t) => t.length >= 3))];
}

/** How many of `terms` occur in `text` (stem-equal, or a ≥4-char prefix either way). 0 = no match. */
export function termHits(terms: string[], text: string): number {
  if (terms.length === 0 || !text) return 0;
  const stems = new Set(words(text).map(stem));
  let hits = 0;
  for (const q of terms) {
    if (stems.has(q)) { hits += 1; continue; }
    if (q.length >= 4) {
      for (const s of stems) {
        if (s.length >= 4 && (s.startsWith(q) || q.startsWith(s))) { hits += 1; break; }
      }
    }
  }
  return hits;
}
