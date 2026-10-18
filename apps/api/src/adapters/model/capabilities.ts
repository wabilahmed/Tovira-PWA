/**
 * [P23-A2] What each model accepts on the Messages API (platform.claude.com migration guides, 2026-10-18).
 *  - explicitEffort: adaptive thinking is on by default, so effort MUST be set explicitly (we never run a
 *    5.5 model at the API's default effort — thinking is billed as output).
 *  - sampling: temperature / top_p / top_k accepted. A non-default value is a 400 on Sonnet 5 and every
 *    5.5 model, so the adapter never forwards one to them.
 *  - canDisableThinking: `thinking: {type: "disabled"}` accepted (Haiku 5.5 at ≤ high effort). On Sonnet
 *    5.5 it is a 400 (the lowest is "between_tools", which only matters with tools — we send none).
 * Neither forced tool_choice nor assistant prefill is used anywhere in this codebase (extraction parses
 * JSON from the text block), so the 5.5 400s on those don't apply.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export type ThinkingMode = 'adaptive' | 'disabled';

export interface ModelCapabilities {
  explicitEffort: boolean;
  sampling: boolean;
  canDisableThinking: boolean;
}

export function modelCapabilities(model: string): ModelCapabilities {
  if (model.startsWith('claude-sonnet-5-5')) return { explicitEffort: true, sampling: false, canDisableThinking: false };
  if (model.startsWith('claude-haiku-5-5')) return { explicitEffort: true, sampling: false, canDisableThinking: true };
  if (model.startsWith('claude-sonnet-5')) return { explicitEffort: false, sampling: false, canDisableThinking: false };
  return { explicitEffort: false, sampling: true, canDisableThinking: false };
}
