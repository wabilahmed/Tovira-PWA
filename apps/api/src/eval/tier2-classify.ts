import type { Extraction } from '../services/extraction/types.js';

/**
 * [TIER2-SPLIT] Attribute each Tier-2 leak to a CLASS, so one class can never be hidden by, or blamed
 * on, another (the failure mode that made "10% Tier-2" unactionable — it lumped a religion/politics leak
 * together with an alias-normalisation miss and a card-last-4 echo).
 *
 * The class is a SCORING concern and lives here, in the gate — never written into the guarded
 * ground-truth fixtures. Health is NOT here: it has its own structured (per-run-zero) + free-text bars.
 */

export type Tier2Class = 'special_category' | 'alias_normalisation' | 'other';

/** Fixture id → Tier-2 class. Add a fixture here when it exercises a class. Unknown ids → 'other'. */
const TIER2_CLASS_BY_FIXTURE: Record<string, Tier2Class> = {
  'special-category-not-a-fact': 'special_category', // religion, ethnicity, politics, sexual orientation
  'client-person-alias': 'alias_normalisation', // a client's nickname/company alias echoed, not normalised
};

export function tier2ClassOf(fixtureId: string): Tier2Class {
  return TIER2_CLASS_BY_FIXTURE[fixtureId] ?? 'other';
}

/** One forbidden term found in the model output, attributed to WHERE it landed and WHICH class. */
export interface LeakRecord {
  fixtureId: string;
  term: string;
  field: string; // which extraction field the term appeared in
  structured: boolean; // true = a structured store (personal_facts / people); false = free text
  cls: Tier2Class;
}

/** The whole extraction, field by field, labelled structured vs free-text. The union covers every
 *  field, so a term found anywhere by leakedValues is found here too (with attribution). Order is
 *  stable: a term is reported in the first field it appears in. */
function fieldsOf(ex: Extraction): Array<{ field: string; structured: boolean; text: string }> {
  const j = (v: unknown): string => JSON.stringify(v ?? null);
  return [
    { field: 'personal_facts', structured: true, text: j(ex.personal_facts) },
    { field: 'people', structured: true, text: j(ex.people) },
    { field: 'summary', structured: false, text: ex.summary ?? '' },
    { field: 'concerns', structured: false, text: j(ex.concerns) },
    { field: 'next_steps', structured: false, text: j(ex.next_steps) },
    { field: 'promises', structured: false, text: j(ex.promises) },
    { field: 'key_dates', structured: false, text: j(ex.key_dates) },
    { field: 'requirements', structured: false, text: j(ex.requirements) },
    { field: 'meeting', structured: false, text: j(ex.meeting) },
  ];
}

/**
 * Locate every forbidden term in the extraction, attributing each to a field + class. Mirrors the
 * leakedValues metric (case-insensitive substring, one record per forbidden term that appears) but adds
 * WHERE and WHICH CLASS — the granularity a gate needs to be actionable.
 */
export function classifyLeaks(fixtureId: string, forbidden: string[], ex: Extraction | null): LeakRecord[] {
  if (!ex || forbidden.length === 0) return [];
  const cls = tier2ClassOf(fixtureId);
  const fields = fieldsOf(ex);
  const out: LeakRecord[] = [];
  for (const term of forbidden) {
    const t = term.toLowerCase();
    const hit = fields.find((f) => f.text.toLowerCase().includes(t));
    if (hit) out.push({ fixtureId, term, field: hit.field, structured: hit.structured, cls });
  }
  return out;
}

export interface Tier2Bar {
  cls: Tier2Class;
  leaks: number;
  exposures: number;
  ratePct: number;
  provisional: boolean; // exposures below the min needed to certify a rate
  passed: boolean; // rate within the ceiling (meaningful only when not provisional)
}

/** One class's bar: rate = leaks / exposures, provisional below minExposures, passed within maxRatePct. */
export function tier2Bar(cls: Tier2Class, leaks: number, exposures: number, minExposures: number, maxRatePct: number): Tier2Bar {
  const ratePct = exposures === 0 ? 0 : (leaks / exposures) * 100;
  return { cls, leaks, exposures, ratePct, provisional: exposures < minExposures, passed: ratePct <= maxRatePct };
}

/**
 * Build a bar for every class that has exposures or leaks. `leaks` counts LEAKING EXPOSURES — distinct
 * (fixture, run) pairs where at least one forbidden term of that class appeared — NOT term-hits. A single
 * echo that trips two overlapping forbidden terms ("Bubu" ⊂ "Bubu DXB") is ONE leaking exposure, so the
 * rate can never exceed 100% (leaking exposures ≤ total exposures). The per-leak printer still shows every
 * term-hit; only the rate denominator is deduped to exposures.
 */
export function tier2Bars(
  records: Array<LeakRecord & { run: number }>,
  exposuresByClass: Partial<Record<Tier2Class, number>>,
  minExposures: number,
  maxRatePct: number,
): Tier2Bar[] {
  const classes: Tier2Class[] = ['special_category', 'alias_normalisation', 'other'];
  return classes
    .map((cls) => {
      const leakingExposures = new Set(records.filter((r) => r.cls === cls).map((r) => `${r.fixtureId}::${r.run}`)).size;
      return tier2Bar(cls, leakingExposures, exposuresByClass[cls] ?? 0, minExposures, maxRatePct);
    })
    .filter((b) => b.exposures > 0 || b.leaks > 0);
}
