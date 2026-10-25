/**
 * [P36-5] A client's wants in one line, read deterministically from their STORED requirements (no model, no
 * guessing): the bedroom count + property type, the area ("in Mirdif"), the latest budget and its history, and a
 * stated deadline. Anything the requirements don't say is simply left out — a missing piece is never invented.
 *
 * [P42-B4] Not every rep sells property. A requirement that names a bedroom count or a property type keeps that
 * format; any other need is read from its own stored text: what they need ("Motor and medical cover"), then the
 * timing and amount the text states ("renewal Jun", "~AED 80K"). Never empty when a requirement exists.
 */
export interface RequirementLike { text: string; requirementRaw: string; statedOn: string | null; createdAt: number }

export interface RequirementSummary {
  /** The client page: "4BR Villa · Mirdif · budget AED 3.4M · decide by 30 Jun"; null when nothing is stated. */
  summary: string | null;
  /** The clients list row: "4BR Villa · Mirdif · AED 3.4M"; null when nothing is stated. */
  listLine: string | null;
  /** Every budget stated, oldest first, consecutive repeats dropped: ["3M", "3.4M"]. */
  budgets: string[];
  /** [P40-3] The budget the wants line shows ("3.4M"), or null. */
  budget?: string | null;
}

const TYPES = ['penthouse', 'townhouse', 'villa', 'apartment', 'flat', 'duplex', 'studio', 'office', 'plot', 'land', 'shop', 'warehouse'];
/** [P40-5] the same thing said another way */
const TYPE_ALIAS: Record<string, string> = { flat: 'apartment' };
const TYPE_RE = new RegExp(`\\b(${TYPES.join('|')})s?\\b`, 'i');
// [P42-B4] "3-bed" (hyphenated, how the extractor often writes it) counts too.
const BEDS_RE = /\b(\d{1,2})[\s-]?(?:br|bed(?:room)?s?)\b/i;
// "in Mirdif", "in Arabian Ranches", "in JVC" — capitalised words after "in" (the stored text keeps the rep's casing).
const AREA_RE = /\bin\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*)*)/;
// [P42-B4] "renewing in June", "in Q3": a month or quarter is timing, never an area.
const NOT_AREA_RE = /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Q[1-4])\b/;
const AMOUNT_RE = /\b(\d+(?:[.,]\d+)?)\s?(m|mn|million|k|thousand)\b/gi;
const DEADLINE_RE = /\b(?:by|before)\s+(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|end of (?:the )?(?:month|year|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)/i;

// [owner, 20 Oct] How the client put the budget sets the wording — a ceiling only when they said one.
const AROUND_BEFORE = /(?:around|about|approx(?:imately|\.)?|roughly|circa|~)\s*(?:aed\s*)?$/i;
const MAX_BEFORE = /(?:max(?:imum)?|up to|no more than|not more than|at most)\s*(?:budget\s*)?(?:(?:of|is)\s*)?(?:aed\s*)?$/i;
type Qualifier = 'around' | 'max' | 'plain';
function qualifierOf(source: string, index: number): Qualifier {
  const before = source.slice(Math.max(0, index - 30), index);
  return AROUND_BEFORE.test(before) ? 'around' : MAX_BEFORE.test(before) ? 'max' : 'plain';
}

function amountLabel(num: string, unit: string): string {
  const n = Number(num.replace(',', '.'));
  const u = unit.toLowerCase();
  return u.startsWith('k') || u === 'thousand' ? `${n}K` : `${n}M`;
}

/** [P39-7] The structured pieces of a client's wants, as stated: what Find's "Clients wanting…" filters on. */
export interface RequirementFacets {
  beds: string | null;
  /** Capitalised: "Villa". */
  type: string | null;
  area: string | null;
  /** Every budget stated, oldest first ("3M", "3.4M"); the last is the current one. */
  budgets: string[];
  qualifier: 'around' | 'max' | 'plain';
  deadline: string | null;
}

export function requirementFacets(reqs: RequirementLike[]): RequirementFacets {
  const ordered = reqs.slice().sort((a, b) => (a.statedOn ?? '').localeCompare(b.statedOn ?? '') || a.createdAt - b.createdAt);
  let beds: string | null = null;
  let type: string | null = null;
  let area: string | null = null;
  let deadline: string | null = null;
  const budgets: string[] = [];
  let qualifier: Qualifier = 'plain';
  for (const r of ordered) {
    for (const t of [r.text, r.requirementRaw]) {
      if (!beds) { const m = BEDS_RE.exec(t); if (m) beds = `${m[1]}BR`; }
      if (!type) { const m = TYPE_RE.exec(t); if (m) type = TYPE_ALIAS[m[1]!.toLowerCase()] ?? m[1]!.toLowerCase(); }
      if (!area) { const m = AREA_RE.exec(t); if (m && !NOT_AREA_RE.test(m[1]!)) area = m[1]!; }
      const d = DEADLINE_RE.exec(t);
      if (d) deadline = d[1]!;
    }
    // A requirement's budget(s): its own text first, else its raw words (the text may have dropped it).
    const own = [...r.text.matchAll(AMOUNT_RE)];
    const src = own.length > 0 ? r.text : r.requirementRaw;
    for (const m of own.length > 0 ? own : [...r.requirementRaw.matchAll(AMOUNT_RE)]) {
      const label = amountLabel(m[1]!, m[2]!);
      if (budgets[budgets.length - 1] !== label) budgets.push(label);
      qualifier = qualifierOf(src, m.index ?? 0); // the latest mention decides the wording
    }
  }
  return { beds, type: type ? type[0]!.toUpperCase() + type.slice(1) : null, area, budgets, qualifier, deadline };
}

/** "3.4M" → 3_400_000; "800K" → 800_000. */
export function budgetAmount(label: string): number {
  const n = Number(label.slice(0, -1));
  return label.endsWith('K') ? n * 1_000 : n * 1_000_000;
}

/** [P40-5] The one requirement a summary reads: the most recent open one that names what they want (a type, bedrooms
 *  or an area) — else the most recent. Fields are NEVER combined across requirements ("1BR" from one, "Villa" from
 *  another was the QA Ahmed bug); the others are counted as "+N more". */
export function primaryRequirement<T extends RequirementLike>(reqs: T[]): T | null {
  const ordered = reqs.slice().sort((a, b) => (a.statedOn ?? '').localeCompare(b.statedOn ?? '') || a.createdAt - b.createdAt);
  const naming = ordered.filter((r) => { const f = requirementFacets([r]); return Boolean(f.beds || f.type || f.area); });
  return naming[naming.length - 1] ?? ordered[ordered.length - 1] ?? null;
}

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_IN = new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}|${MONTH}(?:\\s+\\d{1,2})?|end of (?:the )?(?:month|year|quarter)|Q[1-4])\\b`, 'i');
/** Where a timing clause starts: "renewing in June", "before the board meets on 14 Apr", "by 30 Jun", "due in Q3". */
const TIMING_START = /\b(?:renew(?:s|ing|al)?(?:\s+is)?|before|by|ahead of|due)\b/gi;
const TOPIC_MAX = 48;

/** "June" → "Jun"; "September" → "Sep". */
function shortMonths(s: string): string {
  return s.replace(new RegExp(`\\b(${MONTH})\\b`, 'gi'), (m) => m.slice(0, 3)[0]!.toUpperCase() + m.slice(1, 3).toLowerCase());
}

/** [P42-B4] A non-property need from its own stored text: the topic, and the timing clause the text states (if any). */
function needFromText(text: string): { topic: string | null; timing: string | null } {
  // The amount is shown on its own (as a budget), and an aside in brackets is dropped.
  let t = text.replace(/\s*\([^)]*\)/g, '').trim();
  let timing: string | null = null;
  for (const m of t.matchAll(TIMING_START)) {
    const clause = t.slice(m.index ?? 0).split(/[,;.]/)[0]!;
    if (!DATE_IN.test(clause)) continue;
    t = t.slice(0, m.index ?? 0);
    let c = clause.trim();
    if (/^renew/i.test(c)) c = c.replace(/^renew(?:s|ing|al)?(?:\s+is)?\s+(?:in\s+|on\s+)?/i, 'renewal ');
    else if (/^(?:before|by|ahead of)\s+the\s+/i.test(c)) c = c.replace(/^(?:before|by|ahead of)\s+the\s+/i, '');
    c = c.replace(/\s+(?:on|in)\s+(?=\d|[A-Z])/g, ' ');
    timing = shortMonths(c).trim();
    break;
  }
  // The amount phrase is not part of the topic ("…, package around 80K a month").
  t = t.replace(/,?\s*(?:with\s+)?(?:a\s+)?(?:budget|package|price|premium|fee|salary|paying)?\s*(?:of|is)?\s*(?:around|about|approx(?:imately|\.)?|roughly|circa|~|max(?:imum)?|up to|no more than|not more than|at most)?\s*(?:aed\s*)?\d+(?:[.,]\d+)?\s?(?:m|mn|million|k|thousand)\b.*$/i, '');
  t = t.replace(/[\s,;:-]+$/, '').replace(/\s+(?:for|with|and|to|on|in|at)$/i, '').replace(/^(?:a|an|the)\s+/i, '').trim();
  if (t.length > TOPIC_MAX) {
    // Up to TOPIC_MAX - 1 characters plus "…", cut at the last whole word (a word ending exactly at the limit stays).
    const cut = t.slice(0, TOPIC_MAX);
    const end = cut.lastIndexOf(' ');
    t = `${cut.slice(0, end > 0 ? end : TOPIC_MAX - 1).replace(/[\s,;:-]+$/, '').replace(/\s+(?:for|with|and|to|on|in|at|of|the|a|an|her|his|their)$/i, '').replace(/[\s,;:-]+$/, '')}…`;
  }
  return { topic: t ? t[0]!.toUpperCase() + t.slice(1) : null, timing };
}

export function summarizeRequirements(reqs: RequirementLike[]): RequirementSummary {
  const primary = primaryRequirement(reqs);
  // The labelled budget history ("3M → 3.4M") still lists every budget stated, oldest first.
  const { budgets } = requirementFacets(reqs);
  if (!primary) return { summary: null, listLine: null, budgets, budget: null };
  const ordered = reqs.slice().sort((a, b) => (a.statedOn ?? '').localeCompare(b.statedOn ?? '') || a.createdAt - b.createdAt);
  const names = (r: RequirementLike) => { const f = requirementFacets([r]); return Boolean(f.beds || f.type || f.area); };
  // [P40-5] With exactly ONE property need, a later budget-only message can only be that need's budget (the 20 Oct
  // rule: the latest budget sets the wording), so it is read with it and is not a "+1 more". With two or more
  // needs, a budget-only message is never attached to either.
  const single = ordered.filter(names).length === 1;
  const updates = single ? ordered.filter((r) => r !== primary && !names(r) && (r.statedOn ?? '') >= (primary.statedOn ?? '') && requirementFacets([r]).budgets.length > 0) : [];
  const { beds, type, area, deadline, budgets: own, qualifier } = requirementFacets([primary, ...updates]);
  const more = reqs.length - 1 - updates.length;
  const moreLabel = more > 0 ? `+${more} more` : null;
  // [P39 · owner] Property types capitalised ("4BR Villa"), and budgets always carry AED.
  const what = [beds, type].filter(Boolean).join(' ') || null;
  const budget = own[own.length - 1] ?? null;
  // "budget ~AED 1.5M" (around / about) · "up to AED 3.4M" (max / up to) · "budget AED 3.4M" (said plainly).
  const said = budget ? (qualifier === 'around' ? `~AED ${budget}` : qualifier === 'max' ? `up to AED ${budget}` : `AED ${budget}`) : null;
  // [P42-B4] Not a property need (no bedrooms, no property type): its own words, then timing and amount.
  if (!what) {
    const { topic, timing } = needFromText(primary.text.trim() || primary.requirementRaw.trim());
    const parts = [topic, timing, said, moreLabel].filter((x): x is string => !!x);
    // Never empty: the stored text itself if nothing else was read.
    const line = parts.length > 0 && parts.some((p) => p !== moreLabel) ? parts.join(' · ') : [primary.text.trim() || primary.requirementRaw.trim(), moreLabel].filter(Boolean).join(' · ');
    return { summary: line || null, listLine: line || null, budgets, budget };
  }
  const summaryParts = [what, area, said ? (qualifier === 'max' ? said : `budget ${said}`) : null, deadline ? `decide by ${deadline}` : null, moreLabel].filter((x): x is string => !!x);
  const listParts = [what, area, said, moreLabel].filter((x): x is string => !!x);
  return { summary: summaryParts.length > 1 || (summaryParts.length === 1 && !moreLabel) ? summaryParts.join(' · ') : null, listLine: listParts.length > 1 || (listParts.length === 1 && !moreLabel) ? listParts.join(' · ') : null, budgets, budget };
}
