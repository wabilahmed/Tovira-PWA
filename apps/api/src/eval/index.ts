import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { runGate } from './gate.js';

/**
 * Run the extraction quality gate against the configured model and record the
 * decision (P1-9). Release-blocking: exits non-zero if the gate does not pass.
 *
 * The default stub cannot pass (it isn't a real extractor) — run the real
 * benchmark with e.g. MODEL_PROVIDER=anthropic ANTHROPIC_MODEL=claude-haiku-4-5
 * and again with a Sonnet model to compare.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  const result = await runGate(createModelClient(config), modelId);

  console.log(`\n[gate] model: ${result.model}`);
  const pct = (n: number) => n.toFixed(2);
  console.log(`[gate] promises  precision=${pct(result.metrics.promises.precision)} recall=${pct(result.metrics.promises.recall)}`);
  console.log(`[gate] people    precision=${pct(result.metrics.people.precision)} recall=${pct(result.metrics.people.recall)}`);
  console.log(`[gate] fabricated promises=${result.metrics.fabricatedPromises}  guessed dates=${result.metrics.guessedDates}`);
  console.log(`[gate] DECISION: ${result.passed ? 'PASS' : 'FAIL'}`);
  if (!result.passed) {
    for (const reason of result.reasons) console.log(`  - ${reason}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`[gate] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
