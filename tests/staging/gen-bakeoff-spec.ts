/** Generate the five bake-off exports and write BAKEOFF-SPEC.md (the answer keys to certify). */
import { writeFileSync } from 'node:fs';
import { EXPORTS } from './lib/bakeoff-exports.js';
import { generateExport } from './lib/planting.js';

const out: string[] = [];
out.push('# Bake-off — planting spec + answer keys (AWAITING CERTIFICATION)\n');
out.push('Ground truth by construction (planting generator). Pinned `today = 2026-09-01` (Tuesday):');
out.push('`this Friday`=2026-09-04 · `next Thursday`=2026-09-10 · `in two weeks`=2026-09-15.\n');
out.push('**Hard trust rules (any non-zero on any export disqualifies a model):** fabricated promises, guessed dates, merged people, null-named people, falseCertainties — all MUST be 0.\n');
out.push('**★ STOP — nothing is scored until these answer keys are certified.**\n');

for (const spec of EXPORTS) {
  const { text, answerKey } = generateExport(spec);
  const lineCount = text.split('\n').length;
  out.push(`\n## ${spec.id} — ~${spec.approxLines} lines (generated: ${lineCount}), langs: ${spec.languages.join('/')}`);
  out.push(`Certified languages: ${spec.certifiedLanguages.join('/')}${answerKey.uncertifiedLanguages.length ? ` · UNCERTIFIED (scored separately, a miss is not a regression): ${answerKey.uncertifiedLanguages.join('/')}` : ''}`);
  if (answerKey.needle) out.push(`Needle @ line ${answerKey.needle.atLine}: "${answerKey.needle.fact}"`);

  out.push('\n**Answer key — promises:**');
  if (answerKey.promises.length === 0) out.push('- (none)');
  for (const p of answerKey.promises) out.push(`- "${p.text}" · owner=${p.owner} · due_date=${p.dueDate ?? 'null'} (raw="${p.dueRaw ?? ''}") · confidence=${p.confidence}`);

  out.push('\n**Answer key — people (all named; zero null-named):**');
  out.push(answerKey.people.length ? `- ${answerKey.people.join(', ')}` : '- (none)');

  out.push('\n**Answer key — key_dates:**');
  if (answerKey.keyDates.length === 0) out.push('- (none)');
  for (const k of answerKey.keyDates) out.push(`- ${k.description}: date=${k.date ?? 'null'} (raw="${k.dateRaw ?? ''}")`);

  out.push('\n**Planted traps (expected behaviour):**');
  for (const t of answerKey.traps) out.push(`- **${t.kind}**: ${t.note}`);
}

out.push('\n## Fairness + governance (Task 6)');
out.push('- Identical prompt (v0.6), identical exports, pinned `today` per fixture. No per-model prompt tuning.');
out.push('- Both models cached: warm each cache first, run each ladder back-to-back inside the 1h TTL. Report each model\'s prefix hit rate; **any run < ~90% is void — re-run it** (a cold run inflates cost ~9x and gives a false verdict).');
out.push('- Cheapest first (export 1 → 5); abort the ladder early on any hard-trust violation.');
out.push('- Budget-tracked (ModelBudget): estimate before, abort on overrun, report actual cached/uncached.');
out.push('\n## Decision rule');
out.push('- Haiku **0** hard violations across all five → recommend a formal 3-run P1-9 Haiku re-cert (the gate decides, not this bake-off).');
out.push('- Haiku **any** hard violation → Sonnet stays locked; record the failure shape.');

writeFileSync('BAKEOFF-SPEC.md', out.join('\n') + '\n');
console.log(`wrote BAKEOFF-SPEC.md · exports: ${EXPORTS.map((e) => `${e.id}=${generateExport(e).text.split('\n').length}L`).join(' ')}`);
