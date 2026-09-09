import type { ModelClient } from '../../ports/model.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS, buildUserMessage } from './prompt.js';

/**
 * [EXTRACT-CANARY] One real extraction call, run on a schedule, that asserts a text block comes back.
 *
 * WHY: the EXTRACT-MAXTOKENS breakage was a NEW failure class — a certified engine decayed because the
 * provider flipped claude-sonnet-5 to default reasoning underneath it, and NOTHING told us. The gate
 * proves correctness the day it runs; nothing proved it still held. A daily gate catches drift in a
 * day; this canary catches an outright starvation in HOURS for pennies — one call, no rep attribution.
 *
 * It deliberately mirrors the PRODUCTION extraction call byte-for-byte (same system prompt, same
 * cache breakpoint, same EXTRACTION_MAX_TOKENS) over an input big enough to provoke real reasoning —
 * a one-liner sailed straight through the 2,048 breakage, so a trivial probe would have caught
 * nothing. The pass condition is exactly the signal that was missing in prod: a non-empty text block
 * AND a stop_reason that isn't `max_tokens`. It reports reasoning headroom so decay is visible
 * BEFORE it breaks (thinking creeping toward the ceiling), not only after.
 */

/** A synthetic ~15-message note — enough content to make the model reason substantially (so it sits
 *  in the regime that starved at 2,048), but tiny to bill. Fixed, so the canary is deterministic. */
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

export class ExtractionCanaryError extends Error {
  override name = 'ExtractionCanaryError';
  constructor(stopReason: string | undefined, thinkingTokens: number | undefined, outputTokens: number | undefined) {
    super(`extraction canary starved — no text block (stop_reason=${stopReason ?? 'unknown'}, thinking=${thinkingTokens ?? '?'}, output=${outputTokens ?? '?'}, maxTokens=${EXTRACTION_MAX_TOKENS})`);
  }
}

export interface CanaryResult {
  ok: true;
  stopReason: string | undefined;
  textLength: number;
  thinkingTokens: number | undefined;
  /** max_tokens − output actually produced. Small headroom = decay approaching. */
  headroomTokens: number | undefined;
}

export class ExtractionCanaryService {
  constructor(
    private readonly model: ModelClient,
    private readonly opts: { now?: () => number } = {},
  ) {}

  async run(): Promise<CanaryResult> {
    const today = new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
    const res = await this.model.complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      cacheTtl: '1h',
      messages: [{ role: 'user', content: buildUserMessage({ today, clientName: 'Canary', source: 'paste', text: CANARY_NOTE }) }],
      maxTokens: EXTRACTION_MAX_TOKENS, // MUST match production — the canary certifies the REAL call
      spendClass: 'extraction', // routes to the extraction model; no userId → not billed to any rep
    });

    const text = (res.text ?? '').trim();
    const thinkingTokens = res.usage?.thinkingTokens;
    const outputTokens = res.usage?.outputTokens;
    // The exact signal that was missing in production: text came back, and the budget wasn't
    // exhausted (by reasoning) before the answer.
    const starved = text.length === 0 || res.stopReason === 'max_tokens';
    if (starved) throw new ExtractionCanaryError(res.stopReason, thinkingTokens, outputTokens);

    return {
      ok: true,
      stopReason: res.stopReason,
      textLength: text.length,
      thinkingTokens,
      headroomTokens: outputTokens === undefined ? undefined : EXTRACTION_MAX_TOKENS - outputTokens,
    };
  }
}
