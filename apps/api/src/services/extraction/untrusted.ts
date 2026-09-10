/**
 * [PROMPT-DELIMIT] Shared fencing for UNTRUSTED content in model prompts.
 *
 * A client can write anything into a WhatsApp chat, and the rep imports it — so an imported
 * transcript (and, by the same token, a paste, a voice transcript, or a retrieved note excerpt) is
 * attacker-authorable text that must never be read as instructions. These markers wrap such content
 * in the VARIABLE section of a prompt (never the certified/cached system prefix), so an embedded
 * "ignore previous instructions" is data, not a command. The markers are deliberately unlikely to
 * occur in real chat text; a caller that finds them in input has already been tampered with.
 *
 * This is STRUCTURAL, not a change to the certified extraction rules — the extraction system prompt
 * and its cacheable prefix are untouched, so no re-certification is required.
 */
export const UNTRUSTED_BEGIN = '<<<TOVIRA_UNTRUSTED_BEGIN>>>';
export const UNTRUSTED_END = '<<<TOVIRA_UNTRUSTED_END>>>';

/** Wrap untrusted text in the fence markers. */
export function fenceUntrusted(text: string): string {
  return `${UNTRUSTED_BEGIN}\n${text}\n${UNTRUSTED_END}`;
}
