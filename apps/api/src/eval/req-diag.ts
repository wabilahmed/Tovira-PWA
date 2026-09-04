import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { extractForEval } from './gate.js';
import { EVAL_NOTES } from './eval-set.js';
import { ModelBudget } from '../services/metrics/model-budget.js';
import type { ModelClient } from '../ports/model.js';

/**
 * [REQ-DIAG] Diagnose the requirements false positives before touching Rule 8 (owner: "do not
 * rewrite from intuition — classify first"). Runs the extractor over the eval set N times and dumps
 * every predicted requirement that matched NO expected requirement, tagged by fixture, so each can
 * be bucketed by cause (concern→req, question→req, speculation→req, next-step→req, other). No
 * Rule-7 isolation loop — this is cheaper than the full gate. Prints a per-fixture tally too.
 */
function jaccard(a: string, b: string): number {
  const t = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const A = t(a); const B = t(b);
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter === 0 ? 0 : inter / (A.size + B.size - inter);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  const real = createModelClient(config);
  const budget = new ModelBudget(2.0, 0.5);
  let calls = 0; let hits = 0;
  const model: ModelClient = {
    complete: async (req) => {
      const res = await real.complete(req);
      const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      budget.record('extraction', modelId, u);
      calls += 1;
      if ((u.cacheReadInputTokens ?? 0) > 0) hits += 1;
      return res;
    },
  };

  const RUNS = Math.max(1, Number(process.env.GATE_RUNS ?? 30));
  const perFixture = new Map<string, number>();
  let total = 0;
  console.log(`[req-diag] ${RUNS} runs over ${EVAL_NOTES.length} notes — model ${modelId}\n`);
  for (let run = 1; run <= RUNS; run++) {
    for (const note of EVAL_NOTES) {
      const actual = await extractForEval(model, note);
      const expected = note.expected.requirements ?? [];
      for (const r of actual?.requirements ?? []) {
        const matched = expected.some((e) => Math.max(jaccard(r.requirement_raw, e.requirement_raw), jaccard(r.text, e.text)) >= 0.34);
        if (!matched) {
          total += 1;
          perFixture.set(note.id, (perFixture.get(note.id) ?? 0) + 1);
          console.log(`FP [${note.id}] "${r.text}" ⟵ raw "${r.requirement_raw}"`);
        }
      }
    }
  }

  console.log(`\n[req-diag] === per-fixture tally (${total} FPs total) ===`);
  for (const [id, n] of [...perFixture.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${id}`);
  const b = budget.report();
  console.log(`\n[req-diag] spend $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)}) · cache ${hits}/${calls} (${calls ? Math.round((hits / calls) * 100) : 0}%)`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
