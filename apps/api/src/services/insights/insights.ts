import type { Extraction, ExtractedPerson, PersonalFact } from '../extraction/types.js';

const EMPTY: Extraction = {
  summary: '',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
};

export function extractedOf(value: unknown): Extraction {
  return value && typeof value === 'object' ? { ...EMPTY, ...(value as Partial<Extraction>) } : EMPTY;
}

/**
 * Stakeholder map (P4-2): dedupe people by name (distinct names — "Sarah" vs
 * "Sara" — are NEVER merged) and keep roles + reporting links. A person whose
 * role/decision role is unknown stays "unknown" — no fabricated title.
 */
export function aggregatePeople(extractions: Extraction[]): ExtractedPerson[] {
  const seen = new Map<string, ExtractedPerson>();
  for (const person of extractions.flatMap((e) => e.people)) {
    const key = (person.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, person);
      continue;
    }
    // Merge only same-name mentions: fill in details, prefer a known decision role.
    seen.set(key, {
      name: existing.name,
      role: existing.role ?? person.role,
      reports_to: existing.reports_to ?? person.reports_to,
      decision_role: existing.decision_role !== 'unknown' ? existing.decision_role : person.decision_role,
      notes: existing.notes ?? person.notes,
    });
  }
  return [...seen.values()];
}

/**
 * Personal-facts memory (P4-3): every fact stays attributed to the subject the
 * model recorded it under — never re-attributed to a different person.
 */
export function aggregatePersonalFacts(extractions: Extraction[]): PersonalFact[] {
  const out: PersonalFact[] = [];
  const seen = new Set<string>();
  for (const fact of extractions.flatMap((e) => e.personal_facts)) {
    const key = `${fact.subject}::${fact.fact}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}
