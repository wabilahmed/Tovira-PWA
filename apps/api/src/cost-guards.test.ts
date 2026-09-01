import { describe, it, expect } from 'vitest';
import { loadConfig, AI_TASK_CLASSES } from './config.js';

// COST-GUARDS #1 (routing) — executable, not prose. Only extraction is gate-locked to
// Sonnet; every other class MUST route to the cheaper Haiku. This is also the bake-off
// RESTORE guard: it fails if the committed/default extraction class resolves to anything
// but Sonnet, so the temporary local MODEL_EXTRACTION switch can never leak into the
// committed default. Hermetic: an explicit env with no MODEL_* overrides = committed defaults.
describe('[COST-GUARDS] model routing (committed defaults)', () => {
  const config = loadConfig({ DATABASE_URL: 'x' });

  it('extraction resolves to Sonnet (P1-9 lock + bake-off restore guard)', () => {
    expect(config.models.extraction).toBe('claude-sonnet-5');
  });

  it('NO non-extraction class resolves to Sonnet — every class is covered, not just defaults', () => {
    for (const cls of AI_TASK_CLASSES) {
      if (cls === 'extraction') continue;
      expect(config.models[cls], `${cls} must not route to Sonnet (cost guard)`).not.toMatch(/sonnet/i);
      expect(config.models[cls], `${cls} routes to Haiku`).toMatch(/haiku/i);
    }
  });

  it('the sanctioned bake-off switch is env-only (MODEL_EXTRACTION overrides for a local run)', () => {
    const swapped = loadConfig({ DATABASE_URL: 'x', MODEL_EXTRACTION: 'claude-haiku-4-5-20251001' });
    expect(swapped.models.extraction).toBe('claude-haiku-4-5-20251001'); // env override works
    // ...but the committed default is unaffected — restore is just "unset the env var".
    expect(loadConfig({ DATABASE_URL: 'x' }).models.extraction).toBe('claude-sonnet-5');
  });
});
