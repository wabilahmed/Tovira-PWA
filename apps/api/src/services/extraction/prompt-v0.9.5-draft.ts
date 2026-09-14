/**
 * [RECEIPTS-v0.9.5 DRAFT PROMPT — candidate for certification, NOT wired into production]
 *
 * Materialises the exact v0.9.5 system prompt to CERTIFY (Task 1). Built by transforming the certified
 * v0.9.4 base (prompt.ts EXTRACTION_SYSTEM_PROMPT) with targeted, auditable edits so the base rules and
 * examples stay byte-identical except the intended additions:
 *   (1) source_span + source_message_at added to the 5 fact schema blocks (promise, people,
 *       personal_facts, key_dates, meeting);
 *   (2) a new Rule 9 (source receipts) inserted; the old Rule 9 (valid-JSON) renumbered to 10;
 *   (3) a note that examples A–O predate the receipt fields, plus two new worked examples (P, Q) that
 *       demonstrate a populated import receipt and a null source_message_at for a timestamp-less paste.
 *
 * Every anchor is asserted present; a missing anchor throws at import (a whitespace drift can never
 * silently produce a wrong candidate). The transform is verified byte-for-byte by
 * prompt-v0.9.5-draft.test.ts. If certified (Task 2 sign-off), Task 3 moves this exact string into
 * prompt.ts and bumps PROMPT_VERSION.
 */
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS } from './prompt.js';

export const PROMPT_VERSION_V095 = 'tovira-extract-v0.9.5';
export { EXTRACTION_MAX_TOKENS };

function must(base: string, anchor: string, replacement: string): string {
  if (!base.includes(anchor)) throw new Error(`[v0.9.5] anchor not found (base drifted?): ${JSON.stringify(anchor.slice(0, 48))}`);
  if (base.indexOf(anchor) !== base.lastIndexOf(anchor)) throw new Error(`[v0.9.5] anchor not unique: ${JSON.stringify(anchor.slice(0, 48))}`);
  return base.replace(anchor, replacement);
}

// The two fields, 6-space indent for the array-object blocks, 4-space for the meeting object.
const R6 = ',\n      "source_span": "the verbatim excerpt this fact was drawn from | null",\n      "source_message_at": "YYYY-MM-DDTHH:MM | null"';
const R4 = ',\n    "source_span": "the verbatim excerpt this fact was drawn from | null",\n    "source_message_at": "YYYY-MM-DDTHH:MM | null"';

function buildV095(base: string): string {
  let p = base;
  // (1) schema blocks — each anchored on its unique LAST field.
  p = must(p, '"due_raw": "original phrase | null",\n      "confidence": "high | low"', '"due_raw": "original phrase | null",\n      "confidence": "high | low"' + R6); // promises
  p = must(p, '"notes": "any stated detail about their part in the deal | null"', '"notes": "any stated detail about their part in the deal | null"' + R6); // people
  p = must(p, '"category": "family | hobby | preference | background | other"', '"category": "family | hobby | preference | background | other"' + R6); // personal_facts
  p = must(p, '"type": "birthday | anniversary | launch | deadline | other"', '"type": "birthday | anniversary | launch | deadline | other"' + R6); // key_dates
  p = must(p, '"datetime_raw": "original phrase",\n    "confirmed": false', '"datetime_raw": "original phrase",\n    "confirmed": false' + R4); // meeting

  // (2) insert Rule 9 (source receipts); renumber the valid-JSON rule to 10.
  const rule9 = `9. Source receipts (source_span, source_message_at) — for every promise, key_date, person, personal_fact, and meeting only (requirements already keep requirement_raw; concerns/next_steps/summary have none). Quote into source_span the VERBATIM span you drew the fact from — the specific words exactly as written, not the whole message, the same discipline as requirement_raw in Rule 8. If you cannot point to a clear span, set source_span to null — never paraphrase, reconstruct, or guess it; a fabricated span is as serious as a fabricated date. Set source_message_at to the timestamp of the message that span came from, copied from the per-message timestamps in the input when they are present (an imported chat is rendered as "[timestamp] sender: message"). When the input has no per-message timestamps — a pasted block, a voice-note transcript, a single statement — set source_message_at to null. Never use the note's capture time, today's date, or any other stand-in; there is no correct single message time for those sources, and a wrong timestamp is a wrong fact. Absence is null, never a guess (same as Rules 2 and 5).
10. Output only valid JSON matching the schema. No prose, no explanation, no markdown, no code fences. Nothing before or after the JSON object.`;
  p = must(p, '9. Output only valid JSON matching the schema. No prose, no explanation, no markdown, no code fences. Nothing before or after the JSON object.', rule9);

  // (3) note on the pre-existing examples + two new examples for the receipt fields, inserted before the
  // closing instruction so "follow the shape of these examples exactly" still lands last.
  const closing = 'Follow these rules and the shape of these examples exactly. Output only the JSON object.';
  const addendum = `### Note on the receipt fields in examples A–O

Examples A–O above were written before v0.9.5 and OMIT source_span and source_message_at for brevity. That omission is only for the older examples — your real output MUST include both fields on every promise, key_date, person, personal_fact, and meeting, per Rule 9 and the schema. Examples P and Q show them.

### Example P - an imported chat: source_span quoted verbatim, source_message_at from the message timestamp

Input (an imported WhatsApp export, each line "[timestamp] sender: message"):
"[2026-03-14T09:00:00Z] Omar: any update on the quote?
[2026-03-14T09:05:00Z] Me: yes, I'll send the revised quote by Thursday. also my daughter just started at LSE"

Output:
{"summary":"Omar asked about the quote; rep committed to send the revised quote by Thursday and mentioned his daughter started at LSE.","promises":[{"text":"Send the revised quote","owner":"rep","due_date":null,"due_raw":"Thursday","confidence":"high","source_span":"I'll send the revised quote by Thursday","source_message_at":"2026-03-14T09:05:00Z"}],"people":[{"name":"Omar","role":null,"reports_to":null,"decision_role":"unknown","notes":null,"source_span":"[2026-03-14T09:00:00Z] Omar: any update on the quote?","source_message_at":"2026-03-14T09:00:00Z"}],"personal_facts":[{"subject":"Omar","fact":"Daughter just started at LSE","category":"family","source_span":"my daughter just started at LSE","source_message_at":"2026-03-14T09:05:00Z"}],"key_dates":[],"concerns":[],"next_steps":[],"requirements":[],"meeting":null}

Note: each source_span is copied VERBATIM from the message it came from, and source_message_at is the timestamp of that exact message — the promise/personal fact came from the 09:05 message, the person mention from the 09:00 message. Quote the span, do not paraphrase it.

### Example Q - a pasted note with no per-message timestamp: source_message_at is null

Input (source: a pasted block, no timestamps):
"Told Omar I'll send the revised quote by Thursday. He confirmed the demo is locked in for Thursday 3pm."

Output:
{"summary":"Rep committed to send Omar the revised quote by Thursday; the demo is confirmed for Thursday 3pm.","promises":[{"text":"Send the revised quote","owner":"rep","due_date":null,"due_raw":"Thursday","confidence":"high","source_span":"I'll send the revised quote by Thursday","source_message_at":null}],"people":[],"personal_facts":[],"key_dates":[],"concerns":[],"next_steps":[],"requirements":[],"meeting":{"datetime":null,"datetime_raw":"Thursday 3pm","confirmed":true,"source_span":"the demo is locked in for Thursday 3pm","source_message_at":null}}

Note: the block has no per-message timestamp, so source_message_at is null for BOTH facts — never the capture time, never today. source_span is still quoted verbatim from the block; only the timestamp is unknowable.

${closing}`;
  p = must(p, closing, addendum);
  return p;
}

export const EXTRACTION_SYSTEM_PROMPT_V095 = buildV095(EXTRACTION_SYSTEM_PROMPT);
