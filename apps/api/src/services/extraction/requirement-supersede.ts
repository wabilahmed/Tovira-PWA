/**
 * [P83-8 · owner, 21 Nov] A later requirement that changes a COUNT or LIMIT for the same thing replaces the earlier
 * one, so only the latest shows: O02 "We need at least 3 bedrooms" (March) then X01 "... so we need 4 bedrooms not 3"
 * (September). Deterministic and conservative, the same doctrine as the window merge's LATER WINS (P27-2):
 *  - the slots are counts of one thing: bedrooms, bathrooms, parking, size (sq ft / sqm), seats or users;
 *  - the earlier need is replaced only when it says NOTHING but that one count ("At least 3 bedrooms"). A need that
 *    says more ("3 bedroom villa in Mirdif", "3 bedrooms and 2 parking spaces") is never replaced by a count;
 *  - the later need must be about the same thing: a count on its own, or one that names the old value ("not 3",
 *    "instead of 3"). "2BR apartment for my mother" is another property and replaces nothing;
 *  - the same value said again replaces nothing.
 * Nothing is edited or deleted: the earlier need stays stored (and in the chat); it is only not shown as current.
 */

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const N = '(\\d[\\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten)';
const SLOTS: Array<[string, RegExp]> = [
  ['bedrooms', new RegExp(`\\b${N}\\s*[- ]?(?:br|bhk|bed(?:room)?s?)\\b`, 'gi')],
  ['bathrooms', new RegExp(`\\b${N}\\s*[- ]?bath(?:room)?s?\\b`, 'gi')],
  ['parking', new RegExp(`\\b${N}\\s*[- ]?(?:covered\\s+)?(?:parking(?:\\s+(?:spaces?|spots?|bays?|slots?))?|car\\s*parks?)\\b`, 'gi')],
  ['size', new RegExp(`\\b${N}\\s*(?:sq\\.?\\s*(?:ft|feet|m|metres?|meters?)\\b|sqft\\b|sqm\\b|square\\s+(?:feet|foot|met(?:re|er)s?)\\b|m2\\b|m²)`, 'gi')],
  ['seats', new RegExp(`\\b${N}\\s*(?:seats?|users?|licen[cs]es?|desks?|workstations?)\\b`, 'gi')],
];

// Words that only phrase a count ("we need at least", "make it", "minimum") and the slot nouns themselves.
const COUNT_FILLER = new Set([
  'we', 'they', 'he', 'she', 'i', 'us', 'our', 'their', 'his', 'her', 'my', 'need', 'needs', 'needed', 'want', 'wants', 'looking', 'for',
  'at', 'least', 'most', 'minimum', 'min', 'max', 'maximum', 'up', 'to', 'around', 'about', 'approximately', 'approx', 'roughly', 'exactly',
  'not', 'instead', 'of', 'rather', 'than', 'more', 'now', 'so', 'ok', 'okay', 'actually', 'must', 'have', 'has', 'should', 'make', 'it',
  'change', 'changed', 'update', 'updated', 'revised', 'new', 'only', 'just', 'still', 'total', 'plus', 'a', 'an', 'the', 'and', 'is', 'are',
  'be', 'will', 'would', 'fine', 'x', 'br', 'bhk', 'bed', 'beds', 'bedroom', 'bedrooms', 'bath', 'baths', 'bathroom', 'bathrooms', 'parking',
  'space', 'spaces', 'spot', 'spots', 'bay', 'bays', 'slot', 'slots', 'car', 'cars', 'park', 'parks', 'covered', 'sq', 'ft', 'feet', 'foot',
  'sqft', 'sqm', 'm', 'square', 'metre', 'metres', 'meter', 'meters', 'seat', 'seats', 'user', 'users', 'licence', 'licences', 'license',
  'licenses', 'desk', 'desks', 'workstation', 'workstations', ...Object.keys(NUM_WORDS),
]);

const valueOf = (raw: string): string => {
  const w = NUM_WORDS[raw.toLowerCase()];
  return w !== undefined ? String(w) : String(Number(raw.replace(/,/g, '')));
};

/** Every count a text states, as slot → value ("we need 4 bedrooms not 3" → bedrooms: 4, the first one stated). */
export function countSlots(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [slot, re] of SLOTS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) out.set(slot, valueOf(m[1]!));
  }
  return out;
}

/** True when a text says nothing but counts ("At least 3 bedrooms"). */
function countOnly(text: string): boolean {
  return (text.toLowerCase().match(/[\p{L}]+/gu) ?? []).every((w) => COUNT_FILLER.has(w));
}

/** The later text names the earlier value as the one it replaces: "not 3", "instead of 3", "rather than 3", "from 3". */
function namesOldValue(text: string, old: string): boolean {
  const words = Object.entries(NUM_WORDS).filter(([, n]) => String(n) === old).map(([w]) => w);
  const alt = [old.replace(/[.]/g, '\\.'), ...words].join('|');
  return new RegExp(`\\b(?:not|instead\\s+of|rather\\s+than|from)\\s+(?:the\\s+)?(?:${alt})\\b`, 'i').test(text);
}

export interface SupersedeView { text: string; raw: string }

/**
 * The items (in chat order, earliest first) that a LATER item replaces. Pure; never edits an item.
 */
export function supersededItems<T>(ordered: T[], view: (t: T) => SupersedeView): Set<T> {
  const out = new Set<T>();
  const views = ordered.map((t) => {
    const v = view(t);
    const own = countSlots(v.text);
    return { item: t, v, slots: own.size > 0 ? own : countSlots(v.raw), only: countOnly(v.text) };
  });
  for (let i = 0; i < views.length; i++) {
    const e = views[i]!;
    if (!e.only || e.slots.size !== 1) continue; // only a need that is one count and nothing else
    const [slot, old] = [...e.slots][0]!;
    for (let j = i + 1; j < views.length; j++) {
      const l = views[j]!;
      const now = l.slots.get(slot);
      if (now === undefined || now === old) continue;
      if (l.only || namesOldValue(`${l.v.text} ${l.v.raw}`, old)) { out.add(e.item); break; }
    }
  }
  return out;
}
