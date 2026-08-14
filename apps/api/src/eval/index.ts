import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { extractForEval, evaluateGate, softGate } from './gate.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import { scoreNote, aggregate, type NoteScore } from './score.js';
import type { Extraction } from '../services/extraction/types.js';
import type { ModelClient } from '../ports/model.js';

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
    out.push({ note, actual, score: scoreNote(note.expected, actual, note.mustNotMerge) });
  }
  return out;
}

function line(label: string, m: ReturnType<typeof aggregate>, verdict: string): void {
  console.log(`[gate]   ${label}: promises p=${p(m.promises.precision)} r=${p(m.promises.recall)} · people p=${p(m.people.precision)} r=${p(m.people.recall)} · guessed=${m.guessedDates} fabricated=${m.fabricatedPromises} merged=${m.mergedPeople} → ${verdict}`);
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
  const model = createModelClient(config);
  const allScores: NoteScore[] = [];
  let hardPassed = true;

  for (const run of [1, 2, 3]) {
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
  console.log('\n[gate] === 3-RUN AGGREGATE (soft bars) ===');
  line('AGGREGATE  ', agg, soft.passed ? 'SOFT PASS' : `SOFT FAIL: ${soft.reasons.join('; ')}`);

  const certified = hardPassed && soft.passed;
  console.log(`\n[gate] CERTIFICATION: ${certified ? 'PASS (hard per-run + soft aggregate)' : 'FAIL'}`);
  if (!certified) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[gate] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
