/**
 * [P23-A3] Which eval case fabricates a promise, and what it says. One pass over the certified eval notes
 * (unchanged) through the gate's own extractForEval; for every case with a predicted promise that matches
 * no expected promise, print it beside the case's expected promises. CANDIDATE tooling — not the gate.
 * Prints texts + cost only, never config or environment. Honours GATE_SPEND_CAP_AED.
 */
import { loadConfig } from '../../config.js';
import { createModelClient } from '../../container.js';
import { extractForEval } from '../gate.js';
import { EVAL_NOTES } from '../eval-set.js';
import { scoreNote } from '../score.js';
import type { ModelClient } from '../../ports/model.js';
import { SpendCap } from '../spend-cap.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.models.extraction;
  const cap = SpendCap.fromEnv(process.env);
  const real = createModelClient(config, 'extraction');
  const model: ModelClient = { complete: async (r) => { const res = await real.complete(r); cap.add(modelId, res.usage ?? { inputTokens: 0, outputTokens: 0 }); return res; } };
  const ids = process.env.FAB_DIAG_ONLY?.split(',');
  let fab = 0;
  for (const note of EVAL_NOTES.filter((n) => !ids || ids.includes(n.id))) {
    const actual = await extractForEval(model, note, { aliases: note.aliases });
    const s = scoreNote(note.expected, actual, note.mustNotMerge, note.forbidden);
    if (s.fabricatedPromises === 0) continue;
    fab += s.fabricatedPromises;
    console.log(`\n[fab] ${note.id}: ${s.fabricatedPromises} unmatched predicted promise(s)`);
    for (const p of actual?.promises ?? []) console.log(`[fab]   predicted (${p.owner}, due ${p.due_date ?? 'null'}): ${p.text}  ⟵ span "${p.source_span ?? ''}"`);
    for (const e of note.expected.promises) console.log(`[fab]   expected  (${e.owner}, due ${e.due_date ?? 'null'}): ${e.text}`);
    console.log(`[fab]   note: ${note.note.replace(/\n/g, ' ⏎ ').slice(0, 600)}`);
  }
  console.log(`\n[fab] ${modelId}: ${fab} fabricated across ${ids?.length ?? EVAL_NOTES.length} case(s) · ${cap.calls} call(s) · AED ${cap.spentAed.toFixed(3)}`);
}
main().catch((e: unknown) => { console.error(`[fab] error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
