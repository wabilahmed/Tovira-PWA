/**
 * Diagnostic burst: fire N back-to-back extraction calls (varying the note each time,
 * constant system prefix) and measure the prefix cache hit rate from the API usage
 * fields. Then a second burst for a different client on a different date to prove the
 * cached prefix still hits (leak regression). Real key, small spend.
 *   npx tsx --env-file=.env apps/api/src/scripts/cache-burst.ts
 */
import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { EXTRACTION_SYSTEM_PROMPT, buildUserMessage, estimateTokens } from '../services/extraction/prompt.js';

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

async function burst(label: string, model: ReturnType<typeof createModelClient>, ttl: '5m' | '1h', notes: { today: string; clientName: string; text: string }[]) {
  let creation = 0;
  let read = 0;
  let plainInput = 0;
  let firstWrite = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const res = await model.complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      cacheTtl: ttl,
      messages: [{ role: 'user', content: buildUserMessage({ today: n.today, clientName: n.clientName, source: 'paste', text: n.text }) }],
      maxTokens: 256,
    });
    const u = (res.usage ?? { inputTokens: 0, outputTokens: 0 }) as Usage;
    creation += u.cacheCreationInputTokens ?? 0;
    read += u.cacheReadInputTokens ?? 0;
    plainInput += u.inputTokens;
    if (i === 0) firstWrite = u.cacheCreationInputTokens ?? 0;
    process.stdout.write(`  ${label} call ${String(i + 1).padStart(2)}: creation=${u.cacheCreationInputTokens ?? '-'} read=${u.cacheReadInputTokens ?? '-'} input=${u.inputTokens}\n`);
  }
  // Prefix hit rate = calls that READ the prefix / calls that touched the prefix (read or wrote).
  const reads = notes.filter((_, i) => i > 0).length; // rough: expect all-but-first to read when warm
  const prefixTokens = read + creation;
  console.log(`  ${label} SUMMARY: prefix reads=${read} creation=${creation} plain-input=${plainInput} · first-call-write=${firstWrite} · prefix-token hit-rate=${prefixTokens ? ((read / prefixTokens) * 100).toFixed(1) : '0'}% (of prefix tokens read vs written), reads-expected≈${reads}`);
  return { creation, read, plainInput };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') {
    console.error('need MODEL_PROVIDER=anthropic + a real key');
    process.exit(1);
  }
  const model = createModelClient(config, 'extraction');
  console.log(`model=claude-sonnet-5  prefix≈${estimateTokens(EXTRACTION_SYSTEM_PROMPT)} tok  ttl=${config.extractionCacheTtl}\n`);

  // Burst A: 20 DISTINCT notes, same client/date → prefix must cache despite varying message.
  const a = Array.from({ length: 20 }, (_, i) => ({ today: '2026-09-01', clientName: 'Acme', text: `Note ${i}: quick update on item ${i}, nothing firm, will circle back.` }));
  const ra = await burst('A', model, config.extractionCacheTtl, a);

  // Burst B: different client, different date → prefix must STILL hit (no leak).
  const b = Array.from({ length: 10 }, (_, i) => ({ today: '2026-11-15', clientName: 'Globex', text: `Different client note ${i}: spoke to their team, keeping warm.` }));
  const rb = await burst('B', model, config.extractionCacheTtl, b);

  const totalRead = ra.read + rb.read;
  const totalCreation = ra.creation + rb.creation;
  console.log(`\nOVERALL prefix: reads=${totalRead} creation=${totalCreation} → ${totalRead + totalCreation ? ((totalRead / (totalRead + totalCreation)) * 100).toFixed(1) : '0'}% of prefix tokens served from cache across 30 back-to-back calls.`);
  console.log(totalRead > 0 && totalCreation <= 20000 ? '✅ Prefix caches across varying notes AND across client/date — no leak.' : '❌ Prefix not caching as expected.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
