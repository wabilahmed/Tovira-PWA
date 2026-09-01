import type { ModelClient } from '../ports/model.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../services/extraction/prompt.js';
import { asExtraction } from '../services/extraction/validate.js';
import { extractJsonObject } from '../services/extraction/parse.js';
import type { Extraction } from '../services/extraction/types.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { aggregate, scoreNote, type AggregateMetrics } from './score.js';

/**
 * The certification standard (redefined once temperature proved unpinnable for
 * claude-sonnet-5). HARD rules are per-run, zero-tolerance, on every subset —
 * a wrong fact is worse than a missing one. SOFT bars are checked on the
 * aggregate across 3 runs (a single run's recall is a coin readout).
 */
export const GATE_HARD = {
  maxFabricatedPromises: 0,
  maxGuessedDates: 0,
  maxMergedPeople: 0,
  maxFalseCertainties: 0,
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

/** Run one note through a model and return the parsed+validated extraction. */
export async function extractForEval(model: ModelClient, note: EvalNote): Promise<Extraction | null> {
  let text: string;
  try {
    const res = await model.complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage({ today: note.today, clientName: note.clientName, source: note.source, text: note.note }) }],
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
  try {
    return asExtraction(parsed);
  } catch {
    return null;
  }
}

export async function runEval(
  model: ModelClient,
  modelId: string,
  notes: EvalNote[] = EVAL_NOTES,
): Promise<AggregateMetrics & { model: string }> {
  const scores = [];
  for (const note of notes) {
    const actual = await extractForEval(model, note);
    scores.push(scoreNote(note.expected, actual, note.mustNotMerge));
  }
  return { model: modelId, ...aggregate(scores) };
}

/** HARD per-run gate: zero fabricated promises, zero guessed dates, zero merged people. */
export function evaluateGate(metrics: AggregateMetrics, modelId: string): GateResult {
  const reasons: string[] = [];
  if (metrics.fabricatedPromises > GATE_HARD.maxFabricatedPromises) {
    reasons.push(`fabricated ${metrics.fabricatedPromises} promise(s) — a wrong fact is worse than a missing one`);
  }
  if (metrics.guessedDates > GATE_HARD.maxGuessedDates) {
    reasons.push(`guessed ${metrics.guessedDates} date(s) that should have been left null`);
  }
  if (metrics.mergedPeople > GATE_HARD.maxMergedPeople) {
    reasons.push(`merged ${metrics.mergedPeople} pair(s) of distinct people into one`);
  }
  if (metrics.falseCertainties > GATE_HARD.maxFalseCertainties) {
    reasons.push(`presented ${metrics.falseCertainties} uncertain item(s) as high-confidence — never present an unconfirmed guess as a fact`);
  }
  return { model: modelId, passed: reasons.length === 0, reasons, metrics };
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
