/**
 * [HEALTH-EXCLUSION] Deterministic write-time backstop for extraction Rule 7 ("never record health").
 *
 * Rule 7 tells the model to exclude health, but that is a stochastic model rule — it leaks ~1 in 20
 * (the gate measured 5/170 on the prod path). This is the deterministic guarantee a model rule can't
 * give: any personal_fact the model tagged `category: "health"` is dropped WHOLE before storage, so
 * STRUCTURED health is per-run zero regardless of what the model returns.
 *
 * It drops the whole fact — never edits its text (an altered fact is worse than a missing one; the
 * REDACT doctrine). It is deliberately category-scoped and does NOT scrub free text: a health detail
 * that lands in a summary or concern is left to Rule 7 + the gate's Tier-2 aggregate bar, because a
 * free-text scrub would edit stored evidence and eat legitimate words ("operation", "back", "positive").
 */

/** True when a personal_fact is tagged as health (case/space-insensitive). */
export function isHealthFact(f: { category?: unknown }): boolean {
  return typeof f.category === 'string' && f.category.trim().toLowerCase() === 'health';
}

/**
 * Drop every health-categorised personal_fact from an extraction, in place. Returns how many were
 * removed. Safe on a missing/!array personal_facts field (returns 0).
 */
export function dropHealthPersonalFacts(ex: { personal_facts?: Array<{ category?: unknown }> }): number {
  if (!Array.isArray(ex.personal_facts)) return 0;
  const before = ex.personal_facts.length;
  ex.personal_facts = ex.personal_facts.filter((f) => !isHealthFact(f));
  return before - ex.personal_facts.length;
}
