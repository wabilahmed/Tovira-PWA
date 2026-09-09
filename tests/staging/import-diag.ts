/**
 * [IMPORT-DIAG] Attribute the two unexplained certification signals by dumping the RAW extraction for
 * the three import fixtures ONLY (not the full gate, ~AED 3.5). Answers:
 *   Q1 — Omar's two extra promises: print verbatim; hypothetical-as-commitment (real fabrication
 *        finding) vs a legit commitment the expected missed (fixture error).
 *   Q2 — Imtinan: what DID it return, and do the misses cluster by position (early) or by age (old)?
 * Does not tune anything. Run: MODEL_PROVIDER=anthropic tsx --env-file=.env tests/staging/import-diag.ts
 */
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient } from '../../apps/api/src/container.js';
import { extractImportFixture } from '../../apps/api/src/eval/gate.js';
import { IMPORT_FIXTURES, type FullOutputFixture } from '../../apps/api/src/eval/import-fixtures.js';
import { ModelBudget } from '../../apps/api/src/services/metrics/model-budget.js';
import type { ModelClient } from '../../apps/api/src/ports/model.js';
import type { Extraction } from '../../apps/api/src/services/extraction/types.js';

function dump(ex: Extraction | null): void {
  if (!ex) { console.log('  <null — extraction returned nothing>'); return; }
  console.log(`  PROMISES (${ex.promises.length}):`);
  for (const p of ex.promises) console.log(`    - "${p.text}" | owner=${p.owner} due=${p.due_date ?? 'null'} raw="${p.due_raw ?? ''}" conf=${p.confidence}`);
  console.log(`  PEOPLE (${ex.people.length}):`);
  for (const p of ex.people) console.log(`    - "${p.name}" | role=${p.role ?? 'null'} decision=${p.decision_role}`);
  console.log(`  KEY_DATES (${ex.key_dates.length}):`);
  for (const d of ex.key_dates) console.log(`    - "${d.description}" | date=${d.date ?? 'null'} raw="${d.date_raw ?? ''}"`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic'); process.exit(1); }
  const modelId = config.anthropicModel;
  const budget = new ModelBudget(5.0, 1.0);
  const real = createModelClient(config);
  const model: ModelClient = { complete: async (req) => { const res = await real.complete(req); budget.record('extraction', modelId, res.usage ?? { inputTokens: 0, outputTokens: 0 }); return res; } };

  for (const f of IMPORT_FIXTURES) {
    console.log(`\n================ ${f.id} (${f.mode}) ================`);
    const ex = await extractImportFixture(model, f);
    dump(ex);
    if (f.id === 'import-easy-omar' && ex) {
      const expected = (f as FullOutputFixture).expected.promises.map((p) => p.text.toLowerCase());
      const extra = ex.promises.filter((p) => !expected.some((e) => p.text.toLowerCase().includes(e.split(' ').slice(0, 2).join(' ')) || e.includes(p.text.toLowerCase().split(' ').slice(0, 2).join(' '))));
      console.log(`  >>> Q1 — promises NOT in the 3 expected (candidates for the 2 "extra"):`);
      for (const p of extra) console.log(`      EXTRA: "${p.text}" (due=${p.due_date ?? 'null'} conf=${p.confidence})`);
    }
    if (f.id === 'import-hard-imtinan' && ex) {
      const anchors = ['hold that price', 'renewal before the 30th', 'circle back after the summer', 'updated contract'];
      console.log(`  >>> Q2 — anchor promise recall (transcript is chronological, so earliest date = earliest position):`);
      for (const a of anchors) console.log(`      ${ex.promises.some((p) => p.text.toLowerCase().includes(a)) ? 'FOUND  ' : 'MISSING'} — "${a}"`);
    }
  }
  const b = budget.report();
  console.log(`\n[diag] spend $${b.totalUsd.toFixed(3)} (AED ${b.totalAed.toFixed(2)})`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
