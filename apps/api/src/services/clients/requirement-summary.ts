/**
 * [P36-5] A client's wants in one line, read deterministically from their STORED requirements (no model, no
 * guessing): the bedroom count + property type, the area ("in Mirdif"), the latest budget and its history, and a
 * stated deadline. Anything the requirements don't say is simply left out — a missing piece is never invented.
 */
export interface RequirementLike { text: string; requirementRaw: string; statedOn: string | null; createdAt: number }

export interface RequirementSummary {
  /** The client page: "4BR villa · Mirdif · budget 3.4M · decide by 30 Jun"; null when nothing is stated. */
  summary: string | null;
  /** The clients list row: "4BR villa · Mirdif · 3.4M"; null when nothing is stated. */
  listLine: string | null;
  /** Every budget stated, oldest first, consecutive repeats dropped: ["3M", "3.4M"]. */
  budgets: string[];
}

const TYPES = ['penthouse', 'townhouse', 'villa', 'apartment', 'duplex', 'studio', 'office', 'plot', 'land', 'shop', 'warehouse'];
const TYPE_RE = new RegExp(`\\b(${TYPES.join('|')})s?\\b`, 'i');
const BEDS_RE = /\b(\d{1,2})\s?(?:br|bed(?:room)?s?)\b/i;
// "in Mirdif", "in Arabian Ranches", "in JVC" — capitalised words after "in" (the stored text keeps the rep's casing).
const AREA_RE = /\bin\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*)*)/;
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

export function summarizeRequirements(reqs: RequirementLike[]): RequirementSummary {
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
      if (!type) { const m = TYPE_RE.exec(t); if (m) type = m[1]!.toLowerCase(); }
      if (!area) { const m = AREA_RE.exec(t); if (m) area = m[1]!; }
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
  const what = [beds, type].filter(Boolean).join(' ') || null;
  const budget = budgets[budgets.length - 1] ?? null;
  // "budget ~1.5M" (around / about) · "up to 3.4M" (max / up to) · "budget 3.4M" (said plainly).
  const said = budget ? (qualifier === 'around' ? `~${budget}` : qualifier === 'max' ? `up to ${budget}` : budget) : null;
  const summaryParts = [what, area, said ? (qualifier === 'max' ? said : `budget ${said}`) : null, deadline ? `decide by ${deadline}` : null].filter((x): x is string => !!x);
  const listParts = [what, area, said].filter((x): x is string => !!x);
  return { summary: summaryParts.length > 0 ? summaryParts.join(' · ') : null, listLine: listParts.length > 0 ? listParts.join(' · ') : null, budgets };
}
