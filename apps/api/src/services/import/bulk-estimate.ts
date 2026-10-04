/**
 * [BULK-IMPORT · Task 4] The up-front cost estimate shown on the review screen BEFORE the rep presses
 * Import. Because one chat = one call (D1), the batch cost is simply the sum of each chat's own
 * worst-case ceiling — the exact per-call upper bound the spend gate reserves (anthropicEstimateAed:
 * every input char counted as a token at the cache-WRITE rate + max output). An over-estimate by
 * design: the rep sees the most it could cost, never less. Expressed to the UI as a percentage of the
 * period allowance, consistent with the allowance meter the rep already sees.
 */
import { anthropicEstimateAed } from '../spend/ai-prices.js';
import { buildUserMessage, EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS } from '../extraction/prompt.js';
import type { ModelCompletionRequest } from '../../ports/model.js';

/** The worst-case AED to extract one chat, as the gate would reserve it. */
function oneChatAed(text: string, modelId: string): number {
  const req: ModelCompletionRequest = {
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage({ today: '2026-01-01', clientName: 'client', source: 'whatsapp_export', text }) }],
    maxTokens: EXTRACTION_MAX_TOKENS,
  };
  return anthropicEstimateAed(modelId, req);
}

/** Sum of the per-chat ceilings — one call per chat (D1). Empty batch → 0. */
export function estimateBulkAed(chats: string[], modelId: string): number {
  return chats.reduce((sum, text) => sum + oneChatAed(text, modelId), 0);
}

/** The estimate as a percentage of the period allowance. >100 means the batch would exceed it (the
 *  review screen warns that later chats will pause at the limit). No allowance → Infinity. */
export function percentOfAllowance(estimateAed: number, allowanceAed: number): number {
  if (allowanceAed <= 0) return Infinity;
  return (estimateAed / allowanceAed) * 100;
}
