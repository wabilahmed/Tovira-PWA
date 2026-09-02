import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { extractForEval, evaluateGate, softGate, fabricationGate, GATE_FAB } from './gate.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { scoreNote, aggregate, type NoteScore } from './score.js';
import type { Extraction } from '../services/extraction/types.js';
import type { ModelClient } from '../ports/model.js';
import { ModelBudget } from '../services/metrics/model-budget.js';

/**
 * The P1-9 quality gate under the redefined standard (temperature is deprecated
 * for claude-sonnet-5, so its own low-variance sampling is used):
 *   HARD (per-run, every subset, zero tolerance): 0 guessed dates · 0 fabricated
 *     promises · 0 merged people.
 *   SOFT (aggregate over 3 runs): promises recall ≥ 0.9 · people precision ≥ 0.85
 *     · people recall ≥ 0.8.
 * Runs the eval 3× and reports per-run numbers + the 3-run aggregate. Also names
 * any spurious (fp) person — the people-precision culprit. Exits non-zero on any
 * failure.
 */
const p = (n: number): string => n.toFixed(2);

interface Scored { note: EvalNote; actual: Extraction | null; score: NoteScore }

async function runOnce(model: ModelClient): Promise<Scored[]> {
  const out: Scored[] = [];
  for (const note of EVAL_NOTES) {
    const actual = await extractForEval(model, note);
    // Thread `forbidden` so the gate actually measures leakedValues (REDACT-5 bar = 0);
    // without it the leakage metric is dark and the HARD leak check can never fire.
    out.push({ note, actual, score: scoreNote(note.expected, actual, note.mustNotMerge, note.forbidden) });
  }
  return out;
}

function line(label: string, m: ReturnType<typeof aggregate>, verdict: string): void {
  console.log(`[gate]   ${label}: promises p=${p(m.promises.precision)} r=${p(m.promises.recall)} · people p=${p(m.people.precision)} r=${p(m.people.recall)} · guessed=${m.guessedDates} merged=${m.mergedPeople} falseCert=${m.falseCertainties} leaked=${m.leakedValues} nullNamed=${m.nullNamedPeople} · fab=${m.fabricatedPromises} (aggregate bar) → ${verdict}`);
}

function spuriousPeople(scored: Scored[]): void {
  for (const { note, actual } of scored) {
    const expected = new Set((note.expected.people ?? []).map((x) => (x.name ?? '').trim().toLowerCase()).filter(Boolean));
    for (const x of (actual?.people ?? []).filter((y) => !expected.has((y.name ?? '').trim().toLowerCase()))) {
      console.log(`[gate]   people fp in "${note.id}": predicted "${x.name ?? '∅'}"${x.role ? ` (${x.role})` : ''} — expected: [${[...expected].join(', ') || '∅'}]`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  // Wrap the real client so the gate reports its own cache health + spend (the discipline:
  // warm the prefix, then confirm it's actually being read, and know what the run cost).
  const realModel = createModelClient(config);
  const budget = new ModelBudget(2.0, 0.5);
  let calls = 0;
  let hits = 0;
  const model: ModelClient = {
    complete: async (req) => {
      const res = await realModel.complete(req);
      const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      budget.record('extraction', modelId, u);
      calls += 1;
      if ((u.cacheReadInputTokens ?? 0) > 0) hits += 1;
      return res;
    },
  };
  const allScores: NoteScore[] = [];
  let hardPassed = true;

  // Runs are configurable: 3 (default) is the cheap per-run/soft deploy gate; a fabrication
  // CERTIFICATION needs GATE_RUNS high enough to clear GATE_FAB.minExtractions (~15 = 480).
  const RUNS = Math.max(1, Number(process.env.GATE_RUNS ?? 3));
  for (const run of Array.from({ length: RUNS }, (_, i) => i + 1)) {
    console.log(`\n[gate] === RUN ${run} — model: ${modelId} (default sampling; temperature deprecated) ===`);
    const scored = await runOnce(model);
    const full = aggregate(scored.map((s) => s.score));
    const ml = aggregate(scored.filter((s) => s.note.multilingual).map((s) => s.score));
    const fullGate = evaluateGate(full, modelId);
    const mlGate = evaluateGate(ml, modelId);
    line('FULL SET   ', full, fullGate.passed ? 'HARD PASS' : `HARD FAIL: ${fullGate.reasons.join('; ')}`);
    line('MULTILINGUAL', ml, mlGate.passed ? 'HARD PASS' : `HARD FAIL: ${mlGate.reasons.join('; ')}`);
    if (run === 1) spuriousPeople(scored);
    allScores.push(...scored.map((s) => s.score));
    hardPassed &&= fullGate.passed && mlGate.passed;
  }

  const agg = aggregate(allScores);
  const soft = softGate(agg, modelId);
  console.log(`\n[gate] === ${RUNS}-RUN AGGREGATE (soft bars + fabrication rate) ===`);
  line('AGGREGATE  ', agg, soft.passed ? 'SOFT PASS' : `SOFT FAIL: ${soft.reasons.join('; ')}`);

  // Fabrication: aggregate rate bar (owner ruling). Only a non-provisional pass certifies.
  const fab = fabricationGate(agg, modelId);
  const fabState = fab.provisional
    ? `PROVISIONAL (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}%, but N<${GATE_FAB.minExtractions} — run GATE_RUNS=15 to certify)`
    : fab.passed
      ? `CERTIFIED (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}% ceiling; published ~${GATE_FAB.certifiedRatePct}% from N=${GATE_FAB.justifyingN})`
      : `FAIL: ${fab.reasons.join('; ')}`;
  console.log(`[gate]   FABRICATION: ${fabState}`);

  const b = budget.report();
  const hitPct = calls > 0 ? (hits / calls) * 100 : 0;
  console.log(`\n[gate] cache: ${hits}/${calls} calls read the warm prefix (${hitPct.toFixed(0)}%) · spend $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)})`);

  // Deploy gate = per-run HARD + soft + fabrication not over ceiling. FULL CERTIFICATION
  // additionally requires the fabrication verdict be non-provisional (enough extractions).
  const deployPass = hardPassed && soft.passed && fab.passed;
  const fullyCertified = deployPass && !fab.provisional;
  console.log(`\n[gate] DEPLOY GATE: ${deployPass ? 'PASS (per-run hard + soft + fabrication ≤ ceiling)' : 'FAIL'}`);
  console.log(`[gate] FULL CERTIFICATION: ${fullyCertified ? 'PASS (fabrication rate certified over ≥ minExtractions)' : deployPass ? 'PROVISIONAL — deploy-safe, fabrication rate not yet certified at this N' : 'FAIL'}`);
  if (!deployPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[gate] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
