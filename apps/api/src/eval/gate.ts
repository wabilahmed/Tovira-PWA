import type { ModelClient } from '../ports/model.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage } from '../services/extraction/prompt.js';
import { asExtraction } from '../services/extraction/validate.js';
import { extractJsonObject } from '../services/extraction/parse.js';
import type { Extraction } from '../services/extraction/types.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { aggregate, scoreNote, type AggregateMetrics } from './score.js';

/** The pass thresholds. The two hard rules are non-negotiable: a wrong fact is
 *  worse than a missing one, so ZERO fabricated promises and ZERO guessed dates. */
export const GATE_THRESHOLDS = {
  maxFabricatedPromises: 0,
  maxGuessedDates: 0,
  minPromisesRecall: 0.8,
  minPeopleRecall: 0.7,
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
    scores.push(scoreNote(note.expected, actual));
  }
  return { model: modelId, ...aggregate(scores) };
}

export function evaluateGate(metrics: AggregateMetrics, modelId: string): GateResult {
  const reasons: string[] = [];
  if (metrics.fabricatedPromises > GATE_THRESHOLDS.maxFabricatedPromises) {
    reasons.push(`fabricated ${metrics.fabricatedPromises} promise(s) — a wrong fact is worse than a missing one`);
  }
  if (metrics.guessedDates > GATE_THRESHOLDS.maxGuessedDates) {
    reasons.push(`guessed ${metrics.guessedDates} date(s) that should have been left null`);
  }
  if (metrics.promises.recall < GATE_THRESHOLDS.minPromisesRecall) {
    reasons.push(`promises recall ${metrics.promises.recall.toFixed(2)} < ${GATE_THRESHOLDS.minPromisesRecall}`);
  }
  if (metrics.people.recall < GATE_THRESHOLDS.minPeopleRecall) {
    reasons.push(`people recall ${metrics.people.recall.toFixed(2)} < ${GATE_THRESHOLDS.minPeopleRecall}`);
  }
  return { model: modelId, passed: reasons.length === 0, reasons, metrics };
}

/** Run the full gate against a model: extract the eval set, score, decide. */
export async function runGate(
  model: ModelClient,
  modelId: string,
  notes: EvalNote[] = EVAL_NOTES,
): Promise<GateResult> {
  const metrics = await runEval(model, modelId, notes);
  return evaluateGate(metrics, modelId);
}
