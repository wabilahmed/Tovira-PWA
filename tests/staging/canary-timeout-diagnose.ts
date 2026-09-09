/**
 * [CANARY-DIAGNOSE] The in-prod EXTRACT-CANARY failed on its first real call with "model request
 * failed" — a ModelError, NOT a starvation. The adapter wraps three causes under that one message
 * (fetch threw / abort-timeout at 30s / HTTP non-ok / bad JSON). Prod and local both use
 * modelProvider=anthropic against api.anthropic.com with the SAME 30s default timeout (never wired to
 * config), so this reproduces the exact call locally and MEASURES it: is the failure a >30s timeout
 * (a reasoning-model wall-clock ceiling, the same class as max_tokens) or a real HTTP error?
 *
 * Run: MODEL_PROVIDER=anthropic tsx tests/staging/canary-timeout-diagnose.ts
 */
import { AnthropicModelClient } from '../../apps/api/src/adapters/model/anthropic.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS, buildUserMessage } from '../../apps/api/src/services/extraction/prompt.js';
import { loadConfig } from '../../apps/api/src/config.js';

// The exact canary probe (kept in sync with extraction-canary.ts).
const CANARY_NOTE = [
  'Long catch-up with the buyer at a mid-size account, lots of ground covered so pulling it together.',
  'They confirmed budget is approved for next quarter and want to move before their branch refit.',
  'I committed to sending the revised proposal by Thursday and to looping in their technical lead.',
  'Their finance head has final sign-off; the ops manager is the day-to-day champion.',
  'They flagged a competitor came in cheaper, but were clear price is not the only factor for them.',
  'Asked whether we could include onboarding — I said only if they take the premium tier, nothing promised.',
  'They mentioned wanting to be live before a product launch that has no fixed date yet.',
  'Personal: the buyer is heading on leave after Eid and asked me to follow up after that.',
  'Also a second contact joined late, from a different team, whom I had not met before.',
  'Action items are piling up so I want the structured version to not lose any of it.',
].join(' ');

async function callOnce(label: string, timeoutMs: number): Promise<void> {
  const config = loadConfig();
  const client = new AnthropicModelClient({
    apiKey: config.anthropicApiKey ?? '',
    baseUrl: config.anthropicBaseUrl,
    model: config.models.extraction,
    timeoutMs,
  });
  const today = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();
  try {
    const res = await client.complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      cacheTtl: '1h',
      messages: [{ role: 'user', content: buildUserMessage({ today, clientName: 'Canary', source: 'paste', text: CANARY_NOTE }) }],
      maxTokens: EXTRACTION_MAX_TOKENS,
    });
    const ms = Date.now() - t0;
    const text = (res.text ?? '').trim();
    console.log(`\n[${label}] timeout=${timeoutMs}ms → OK in ${ms}ms`);
    console.log(`  wall-clock: ${ms}ms  (would 30s-timeout abort? ${ms > 30_000 ? 'YES' : 'no'})`);
    console.log(`  stop_reason=${res.stopReason} textLen=${text.length} thinking=${res.usage?.thinkingTokens} output=${res.usage?.outputTokens}`);
  } catch (err) {
    const ms = Date.now() - t0;
    const cause = (err as { cause?: unknown }).cause;
    console.log(`\n[${label}] timeout=${timeoutMs}ms → FAILED in ${ms}ms`);
    console.log(`  error: ${(err as Error).message}`);
    console.log(`  cause: ${JSON.stringify(cause) === '{}' ? (cause as Error)?.name ?? String(cause) : JSON.stringify(cause)}`);
    console.log(`  → ${ms >= 29_000 && ms <= 31_000 ? 'looks like the 30s ABORT (wall-clock ceiling)' : 'NOT a 30s abort — inspect the cause above'}`);
  }
}

async function main(): Promise<void> {
  console.log('=== CANARY-DIAGNOSE: reproducing the exact canary call ===');
  // 1) Long timeout: measure true wall-clock + confirm the call itself succeeds given enough time.
  await callOnce('long-timeout measurement', 120_000);
  // 2) The production 30s default: does it abort?
  await callOnce('production 30s default', 30_000);
}

main().catch((e) => { console.error(e); process.exit(1); });
