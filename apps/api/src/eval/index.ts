import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { extractForEval, evaluateGate, softGate, fabricationGate, tier1Residual, tier2Gate, GATE_FAB, GATE_TIER2 } from './gate.js';
import { redactSensitive } from '../services/redaction/redact.js';
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
  const runsToCertify = Math.ceil(GATE_FAB.minExtractions / EVAL_NOTES.length);
  const fabState = fab.provisional
    ? `PROVISIONAL (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}%, but N<${GATE_FAB.minExtractions} — run GATE_RUNS=${runsToCertify} to certify)`
    : fab.passed
      ? `CERTIFIED (${agg.fabricatedPromises}/${fab.extractions} = ${fab.ratePct.toFixed(2)}% ≤ ${GATE_FAB.maxRatePct}% tripwire; published rate ${GATE_FAB.certifiedRatePct}% from N=${GATE_FAB.justifyingN})`
      : `FAIL: ${fab.reasons.join('; ')}`;
  console.log(`[gate]   FABRICATION: ${fabState}`);

  // LEAKAGE — reported as TWO distinct guarantees, never one number (owner condition).
  // TIER-1 (format): deterministic, ingest-enforced, per-run ZERO. Verified without the model.
  const tier1Bad = tier1Residual(EVAL_NOTES);
  const tier1Pass = tier1Bad.length === 0;
  console.log(`[gate]   TIER-1 LEAKAGE: ${tier1Pass ? '0 — deterministically enforced at ingest (redact.ts idempotent; no residual pattern)' : `FAIL — redact.ts left a residual Tier-1 pattern in: ${tier1Bad.join(', ')}`}`);

  // TIER-2 (meaning: religion/health/…): model-enforced (Rule 7), stochastic → AGGREGATE bar.
  // On the ingest-redacted path, any leakedValues are Tier-2 by construction. Exposures = the
  // count of Tier-2-bearing fixtures (a forbidden value survives ingest redaction) × runs.
  const t2Fixtures = EVAL_NOTES.filter((n) => (n.forbidden ?? []).some((f) => redactSensitive(n.note).redacted.includes(f)));
  const tier2Exposures = t2Fixtures.length * RUNS;
  const t2 = tier2Gate(agg, tier2Exposures, modelId);
  const t2State = t2.provisional
    ? `PROVISIONAL (${agg.leakedValues}/${tier2Exposures} = ${t2.ratePct.toFixed(2)}%, but exposures<${GATE_TIER2.minExposures})`
    : t2.passed
      ? `${t2.ratePct.toFixed(2)}% (${agg.leakedValues}/${tier2Exposures}) ≤ ${GATE_TIER2.maxRatePct}% ceiling — model-enforced (Rule 7), aggregate bar`
      : `FAIL: ${t2.reasons.join('; ')}`;
  console.log(`[gate]   TIER-2 LEAKAGE: ${t2State}`);

  // Rule 7 ISOLATION SIGNAL (non-gating): feed RAW values (no ingest redaction) to measure how
  // often the MODEL itself reproduces a Tier-1 value — the defense-in-depth layer for a pattern
  // redact.ts doesn't recognise. Never gates (prod redacts at ingest first); tracked for drift.
  const redFixtures = EVAL_NOTES.filter((n) => (n.forbidden?.length ?? 0) > 0);
  let r7Leaks = 0;
  let r7Total = 0;
  for (let i = 0; i < RUNS; i++) {
    for (const note of redFixtures) {
      const raw = await extractForEval(model, note, { redactIngest: false });
      r7Total += 1;
      if (scoreNote(note.expected, raw, note.mustNotMerge, note.forbidden).leakedValues > 0) r7Leaks += 1;
    }
  }
  const r7Pct = r7Total ? (r7Leaks / r7Total) * 100 : 0;
  console.log(`[gate]   RULE-7 ISOLATION (non-gating, defense-in-depth): ${r7Leaks}/${r7Total} raw extractions reproduced a value (${r7Pct.toFixed(2)}%) — prod redacts Tier-1 at ingest; tracked for drift`);

  const b = budget.report();
  const hitPct = calls > 0 ? (hits / calls) * 100 : 0;
  console.log(`\n[gate] cache: ${hits}/${calls} calls read the warm prefix (${hitPct.toFixed(0)}%) · spend $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)})`);

  // Deploy gate = per-run HARD + soft + Tier-1 zero + fabrication & Tier-2 not over ceiling.
  // FULL CERTIFICATION additionally requires the aggregate verdicts be non-provisional.
  const deployPass = hardPassed && soft.passed && tier1Pass && fab.passed && t2.passed;
  const fullyCertified = deployPass && !fab.provisional && !t2.provisional;
  console.log(`\n[gate] DEPLOY GATE: ${deployPass ? 'PASS (per-run hard + soft + Tier-1 zero + fabrication & Tier-2 ≤ ceiling)' : 'FAIL'}`);
  console.log(`[gate] FULL CERTIFICATION: ${fullyCertified ? 'PASS (aggregate rates certified over ≥ minimum sample)' : deployPass ? 'PROVISIONAL — deploy-safe, an aggregate rate not yet certified at this N' : 'FAIL'}`);
  if (!deployPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[gate] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
