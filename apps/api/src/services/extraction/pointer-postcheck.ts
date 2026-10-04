/**
 * [POINTERS · Task 3] The DETERMINISTIC post-check that runs on the model's pointers BEFORE they are
 * saved — the trust spine (the model is never asked to police itself). In order:
 *   1. Receipts (D3): drop any pointer with no VALID receipt. A receipt is valid when it cites a message
 *      in THIS call's input (by timestamp, or by a verbatim span for an untimestamped note) OR a message
 *      already cited by the client's current pointers (so a carried-forward pointer, D7, stays valid).
 *      Invalid receipts are stripped; a pointer left with none is dropped.
 *   2. Sensitive screen (D5): drop any pointer whose free text the sensitive screen flags.
 *   3. Retrospective (D6): keep a 'retrospective' pointer ONLY for a rep-confirmed loss; otherwise drop
 *      it. When a retrospective survives, the exact disclosure is attached (appended by code, not model).
 */
import { screenSensitive } from '../screening/sensitive-screen.js';
import type { Pointer, PointerReceipt, DealState } from './types.js';

/** [D6] The retrospective always ends with exactly this line. Appended deterministically. */
export const RETROSPECTIVE_DISCLOSURE =
  'This is our best reading of what happened, based on your messages. It may not be accurate.';

export interface PointerCheckInput {
  pointers: Pointer[];
  /** The model-safe text the model saw (to verify a span verbatim for an untimestamped note). */
  inputText: string;
  /** Message timestamps present in this call's input (note.messages[].sentAt). */
  inputMessageAts: Set<string>;
  /** The client's current pointers, so a carried-forward receipt (an older message) stays valid (D7). */
  currentPointers: Pointer[];
  /** Where the deal stands — a retrospective is allowed ONLY when this is 'lost' (rep-confirmed). */
  dealState: DealState;
}

export interface PointerCheckResult {
  pointers: Pointer[];
  /** The exact disclosure line when a retrospective survived; null otherwise. */
  retrospectiveDisclosure: string | null;
}

export function checkPointers(input: PointerCheckInput): PointerCheckResult {
  const currentAts = new Set<string>();
  const currentSpans = new Set<string>();
  for (const p of input.currentPointers) {
    for (const r of p.receipts) {
      if (r.source_message_at) currentAts.add(r.source_message_at);
      if (r.source_span) currentSpans.add(r.source_span);
    }
  }
  const receiptValid = (r: PointerReceipt): boolean => {
    if (r.source_message_at) return input.inputMessageAts.has(r.source_message_at) || currentAts.has(r.source_message_at);
    return typeof r.source_span === 'string' && r.source_span.length > 0 && (input.inputText.includes(r.source_span) || currentSpans.has(r.source_span));
  };

  const out: Pointer[] = [];
  for (const p of input.pointers) {
    // 1. receipts — strip invalid, drop a pointer left with none.
    const receipts = (p.receipts ?? []).filter(receiptValid);
    if (receipts.length === 0) continue;
    // 2. sensitive screen on the free text.
    if (screenSensitive(p.text).length > 0) continue;
    // 3. retrospective only for a rep-confirmed loss.
    if (p.section === 'retrospective' && input.dealState !== 'lost') continue;
    out.push({ ...p, receipts });
  }

  const retrospectiveDisclosure = out.some((p) => p.section === 'retrospective') ? RETROSPECTIVE_DISCLOSURE : null;
  return { pointers: out, retrospectiveDisclosure };
}
