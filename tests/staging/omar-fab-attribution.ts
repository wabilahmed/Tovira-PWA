/**
 * [OMAR-FAB] Attribution for the CI "fab 1" on import-easy-omar. The gate scores it full-output;
 * scoreNote counts any predicted promise not matching the hand-written expected as a fabrication.
 * This runs the fixture N times and, for each run, prints every promise and flags the ones scoreNote
 * calls fabrications (fp) — so we can see WHETHER the "fab" is a reworded-legit promise (scorer wrong)
 * or a real fabrication (e.g. the onboarding hypothetical). Run BEFORE changing the bar.
 * MODEL_PROVIDER=anthropic tsx --env-file=.env tests/staging/omar-fab-attribution.ts
 */
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient } from '../../apps/api/src/container.js';
import { extractImportFixture } from '../../apps/api/src/eval/gate.js';
import { IMPORT_FIXTURES, type FullOutputFixture } from '../../apps/api/src/eval/import-fixtures.js';
import { scoreNote } from '../../apps/api/src/eval/score.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') { console.error('need anthropic'); process.exit(1); }
  const model = createModelClient(config);
  const f = IMPORT_FIXTURES.find((x) => x.id === 'import-easy-omar') as FullOutputFixture;
  const RUNS = 5;
  for (let i = 1; i <= RUNS; i++) {
    const actual = await extractImportFixture(model, f);
    if (!actual) { console.log(`run ${i}: <null>`); continue; }
    const s = scoreNote(f.expected, actual, [], f.forbidden);
    console.log(`\n=== run ${i}: fab=${s.fabricatedPromises} recall promises.fn=${s.promises.fn} people.fn=${s.people.fn} ===`);
    for (const p of actual.promises) {
      const matched = f.expected.promises.some((e) => e.text.toLowerCase().split(' ').slice(0, 2).join(' ') && p.text.toLowerCase().includes(e.text.toLowerCase().split(' ').slice(1, 3).join(' ')));
      console.log(`   promise: "${p.text}" [owner ${p.owner}, due ${p.due_date ?? 'null'}, conf ${p.confidence}]${matched ? '' : '  <-- candidate FAB (no clean expected match)'}`);
    }
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
