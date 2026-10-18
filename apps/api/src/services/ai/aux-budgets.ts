/**
 * [P23-A2] Output ceilings (max_tokens) for the aux calls, in one place. They were sized on Haiku 4.5;
 * Haiku 5.5's tokenizer counts ~30% more tokens for the same text, so each carries that headroom — an
 * answer of the same length still fits. (Aux thinking is off by default on Haiku 5.5 — AUX_THINKING — so
 * no thinking competes for these.) A ceiling only bounds output; it never adds cost by itself.
 */
export const TOKENIZER_HEADROOM = 1.3;
const withHeadroom = (haiku45: number): number => Math.ceil(haiku45 * TOKENIZER_HEADROOM);

export const AUX_MAX_TOKENS = {
  recall: withHeadroom(512),
  capture: withHeadroom(120),
  priorities: withHeadroom(256),
  draft: withHeadroom(512),
  meeting: withHeadroom(4096),
} as const;
