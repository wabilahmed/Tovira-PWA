import type { ModelClient } from '../ports/model.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../services/extraction/prompt.js';
import { asExtraction } from '../services/extraction/validate.js';
import { extractJsonObject } from '../services/extraction/parse.js';
import type { Extraction } from '../services/extraction/types.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { aggregate, scoreNote, type AggregateMetrics } from './score.js';
import { redactSensitive } from '../services/redaction/redact.js';

/**
 * The certification standard (redefined once temperature proved unpinnable for
 * claude-sonnet-5). HARD rules are per-run, zero-tolerance, on every subset —
 * a wrong fact is worse than a missing one. SOFT bars are checked on the
 * aggregate across the runs (a single run's recall is a coin readout).
 *
 * Fabrication is the ONE exception (owner ruling, post-FAB-INVESTIGATE): it has a
 * demonstrated irreducible floor — Sonnet fabricates a promise at ~0.2%/extraction
 * (2 in 911, matched-measured; not caused by any prompt version), scattered, not
 * pinnable. A per-run zero-tolerance bar therefore fails ~a third of 3-run attempts
 * by construction, which trains everyone to re-roll — how a gate dies. So fabrication
 * moves to an AGGREGATE rate ceiling with a stated, product-anchored tolerance; every
 * other hard metric stays per-run zero.
 */
export const GATE_HARD = {
  maxGuessedDates: 0,
  maxMergedPeople: 0,
  maxFalseCertainties: 0,
  maxLeakedValues: 0,
  maxNullNamedPeople: 0,
};
/**
 * Aggregate fabrication bar. Two DIFFERENT numbers — never conflate them:
 *
 *   certifiedRatePct = 0.27%  — the PUBLISHED rate. What Tovira actually does: fabrication
 *       measured at 5 / 1,871 extractions across all v0.7+v0.8 sampling (matched runs, both
 *       certs, the targeted + diagnostic passes). ≈ one low-confidence, queued item per rep
 *       per ~4 months — never an asserted fact. This is the number to quote.
 *
 *   maxRatePct = 1.0%  — the gate TRIPWIRE. NOT the rate; the point at which a sample proves
 *       the rate got worse. Derivation (record, so nobody later "tightens" it into flakiness):
 *       the 95% Poisson CI on 5/1,871 is [0.09%, 0.63%]. A ceiling must clear the 0.63% upper
 *       bound or it false-fails healthy samples (0.5% did — cert2 landed at 0.63%). At the
 *       certification sample size N=480, ≥5 fabrications (=1.04%) is the ~95% significance
 *       threshold for "materially above 0.27%"; below it is sampling noise on the true rate,
 *       at/above it is a real regression. So 1.0% at N≥480 is the detection threshold for the
 *       published rate at that N — not a loosening. (A 0.5% ceiling would need N≈1,900 / ~$16
 *       per cert to be non-flaky; less frequent certification is worse for quality than a
 *       slightly wider tripwire.) False-fail ~1% here, vs 37% for per-run-zero.
 *
 * certifiedRatePct is RE-MEASURED each certification, never inherited: every cert adds its
 * extractions to the cumulative denominator (see FAB-REPORT). If the true rate drifts toward
 * 0.5% you learn it from the published number long before the 1.0% tripwire ever fires.
 *
 * Below minExtractions the fabrication verdict is PROVISIONAL, never a certification.
 */
export const GATE_FAB = {
  maxRatePct: 1.0,
  minExtractions: 480,
  certifiedRatePct: 0.27,
  justifyingN: 1871,
};
export const GATE_SOFT = {
  minPromisesRecall: 0.9,
  minPeoplePrecision: 0.85,
  minPeopleRecall: 0.8,
};

export interface GateResult {
  model: string;
  passed: boolean;
  reasons: string[];
  metrics: AggregateMetrics;
}

/** Run one note through a model and return the parsed+validated extraction.
 *  `redactIngest` (default true) mirrors production: strip Tier-1 values before extraction.
 *  Pass false ONLY to measure Rule 7's isolation miss-rate (the defense-in-depth signal). */
export async function extractForEval(model: ModelClient, note: EvalNote, opts: { redactIngest?: boolean } = {}): Promise<Extraction | null> {
  let text: string;
  // Ingest redaction FIRST — production strips Tier-1 values before extraction, so the
  // model never sees them. The gate tests that shipped guarantee (the leakage bar now
  // measures redact.ts, deterministic), not the model's Rule-7 willingness to decline a
  // value it was handed. Rule 7's isolation miss-rate is measured separately (non-gating).
  const redactedNote = opts.redactIngest === false ? note.note : redactSensitive(note.note).redacted;
  try {
    const res = await model.complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      cacheTtl: '1h',
      messages: [{ role: 'user', content: buildUserMessage({ today: note.today, clientName: note.clientName, source: note.source, text: redactedNote }) }],
      maxTokens: 2048,
      // temperature intentionally unset — deprecated for claude-sonnet-5 (see
      // extraction-service). The gate certifies determinism by running twice.
    });
    text = res.text;
  } catch {
    return null;
  }
  const parsed = extractJsonObject(text);
  if (parsed === null) return null;
  let ex: Extraction | null;
  try {
    ex = asExtraction(parsed);
  } catch {
    return null;
  }
  if (ex === null) return null;
  // Apply the production DATE-INVARIANT (extractNote enforces it at write time): a
  // promise cannot be due before the note's reference date. The gate must score the
  // full pipeline, not the raw prompt output — else an invariant-backed key can't pass.
  for (const promise of ex.promises) {
    if (promise.due_date !== null && promise.due_date < note.today) {
      promise.due_date = null;
      promise.confidence = 'low';
    }
  }
  return ex;
}

export async function runEval(
  model: ModelClient,
  modelId: string,
  notes: EvalNote[] = EVAL_NOTES,
): Promise<AggregateMetrics & { model: string }> {
  const scores = [];
  for (const note of notes) {
    const actual = await extractForEval(model, note);
    scores.push(scoreNote(note.expected, actual, note.mustNotMerge, note.forbidden));
  }
  return { model: modelId, ...aggregate(scores) };
}

/** HARD per-run gate: zero guessed dates, merges, false certainties, leaks, null-named
 *  people. Fabrication is NOT here — it is an aggregate rate bar (see fabricationGate). */
export function evaluateGate(metrics: AggregateMetrics, modelId: string): GateResult {
  const reasons: string[] = [];
  if (metrics.guessedDates > GATE_HARD.maxGuessedDates) {
    reasons.push(`guessed ${metrics.guessedDates} date(s) that should have been left null`);
  }
  if (metrics.mergedPeople > GATE_HARD.maxMergedPeople) {
    reasons.push(`merged ${metrics.mergedPeople} pair(s) of distinct people into one`);
  }
  if (metrics.falseCertainties > GATE_HARD.maxFalseCertainties) {
    reasons.push(`presented ${metrics.falseCertainties} uncertain item(s) as high-confidence — never present an unconfirmed guess as a fact`);
  }
  if (metrics.leakedValues > GATE_HARD.maxLeakedValues) {
    reasons.push(`leaked ${metrics.leakedValues} sensitive value(s) into the output — a Tier-1 value must never reach any field`);
  }
  if (metrics.nullNamedPeople > GATE_HARD.maxNullNamedPeople) {
    reasons.push(`emitted ${metrics.nullNamedPeople} person(s) with no name — a role-only reference is never a person (Rule 5)`);
  }
  return { model: modelId, passed: reasons.length === 0, reasons, metrics };
}

export interface FabGateResult extends GateResult {
  ratePct: number;
  extractions: number;
  provisional: boolean; // sample below minExtractions — reported, but not a certification
}

/**
 * AGGREGATE fabrication bar: rate = fabricated / total extractions, over ALL runs.
 * Below GATE_FAB.minExtractions the verdict is PROVISIONAL (too small a sample to
 * certify a ~0.2% event) — passed reflects the ceiling, but it is not a certification.
 */
export function fabricationGate(metrics: AggregateMetrics, modelId: string): FabGateResult {
  const extractions = metrics.notes;
  const ratePct = extractions === 0 ? 0 : (metrics.fabricatedPromises / extractions) * 100;
  const provisional = extractions < GATE_FAB.minExtractions;
  const over = ratePct > GATE_FAB.maxRatePct;
  const reasons = over
    ? [`fabrication rate ${ratePct.toFixed(2)}% (${metrics.fabricatedPromises}/${extractions}) > ceiling ${GATE_FAB.maxRatePct}% — a wrong fact is worse than a missing one`]
    : [];
  return { model: modelId, passed: !over, reasons, metrics, ratePct, extractions, provisional };
}

/** SOFT gate on the 3-run aggregate: recall/precision bars (averaged, not per-run). */
export function softGate(metrics: AggregateMetrics, modelId: string): GateResult {
  const reasons: string[] = [];
  if (metrics.promises.recall < GATE_SOFT.minPromisesRecall) {
    reasons.push(`promises recall ${metrics.promises.recall.toFixed(2)} avg < ${GATE_SOFT.minPromisesRecall}`);
  }
  if (metrics.people.precision < GATE_SOFT.minPeoplePrecision) {
    reasons.push(`people precision ${metrics.people.precision.toFixed(2)} avg < ${GATE_SOFT.minPeoplePrecision}`);
  }
  if (metrics.people.recall < GATE_SOFT.minPeopleRecall) {
    reasons.push(`people recall ${metrics.people.recall.toFixed(2)} avg < ${GATE_SOFT.minPeopleRecall}`);
  }
  return { model: modelId, passed: reasons.length === 0, reasons, metrics };
}

/** Run the HARD per-run gate against a model: extract the eval set, score, decide. */
export async function runGate(
  model: ModelClient,
  modelId: string,
  notes: EvalNote[] = EVAL_NOTES,
): Promise<GateResult> {
  const metrics = await runEval(model, modelId, notes);
  return evaluateGate(metrics, modelId);
}
