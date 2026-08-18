/**
 * Empirical prompt-cache check (run with a REAL key — small spend).
 *
 *   set -a; . ./.env; set +a
 *   npx tsx apps/api/src/scripts/verify-cache.ts
 *
 * It sends the extraction system prefix (cacheSystemPrompt: true) to the routed
 * extraction model TWICE. Proof that caching is on:
 *   - call 1 writes the cache  → cache_creation_input_tokens > 0, cache_read = 0
 *   - call 2 reads the cache    → cache_read_input_tokens ≈ the prefix size
 * If both cache fields are absent/0 on call 2, caching is NOT working.
 */
import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage, estimateTokens } from '../services/extraction/prompt.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') {
    console.error(`MODEL_PROVIDER is "${config.modelProvider}" — set MODEL_PROVIDER=anthropic + ANTHROPIC_API_KEY to verify real caching.`);
    process.exit(1);
  }
  const model = createModelClient(config, 'extraction');
  const modelId = (model as { modelId?: string }).modelId ?? config.models.extraction;
  const message = buildUserMessage({ today: '2026-08-18', clientName: 'Acme', source: 'paste', text: 'Quick note: I will send the revised quote Friday.' });
  const req = {
    system: EXTRACTION_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    cacheTtl: config.extractionCacheTtl,
    messages: [{ role: 'user' as const, content: message }],
    maxTokens: 512,
  };

  console.log(`model: ${modelId}  ·  cache TTL: ${config.extractionCacheTtl} (EXTRACTION_CACHE_TTL)`);
  console.log(`prefix ~${estimateTokens(EXTRACTION_SYSTEM_PROMPT)} tokens (est.)\n`);

  let lastRead = 0;
  for (let i = 1; i <= 2; i++) {
    const res = await model.complete(req);
    const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
    console.log(
      `call ${i}: input=${u.inputTokens}  cache_creation=${u.cacheCreationInputTokens ?? '-'}  ` +
        `cache_read=${u.cacheReadInputTokens ?? '-'}  output=${u.outputTokens}`,
    );
    if (i === 2) lastRead = u.cacheReadInputTokens ?? 0;
  }

  console.log('');
  if (lastRead > 0) console.log(`✅ CACHING WORKS — call 2 read ${lastRead} tokens from the cache (not re-billed).`);
  else console.log('❌ NO CACHE READ on call 2 — caching is NOT working.');
  process.exit(lastRead > 0 ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
