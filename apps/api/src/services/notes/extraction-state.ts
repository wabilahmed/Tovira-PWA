/**
 * [ASYNC-EXTRACT task 4] The rep-facing extraction state of a note. Now that extraction is async,
 * a rep watching an import must never be unsure whether it worked — so every note maps to ONE of four
 * unambiguous states, derived from existing fields (no extra DB column):
 *
 *   queued      — captured, waiting for the sweep (pending, not yet attempted)
 *   processing  — the sweep has picked it up (pending, at least one attempt in flight/made)
 *   done        — extracted
 *   failed      — needs_review or import_failed (a terminal FAILURE — surfaced as failed, never as
 *                 "still processing", so a rep is never left staring at a spinner on a dead note)
 *
 * The failed states are terminal and explicit: the whole point is that a failure reads as failed.
 */
export type ExtractionState = 'queued' | 'processing' | 'done' | 'failed';

export function extractionState(note: { status: string; sweepAttempts?: number }): ExtractionState {
  switch (note.status) {
    case 'extracted':
      return 'done';
    case 'needs_review':
    case 'import_failed':
      return 'failed';
    case 'pending_transcription':
    case 'pending_extraction':
      return (note.sweepAttempts ?? 0) > 0 ? 'processing' : 'queued';
    default:
      // Any other non-terminal state (e.g. awaiting a counterpart confirmation) is "waiting", not
      // active work — surface it as queued, never as processing and never as a silent failure.
      return 'queued';
  }
}

export interface ExtractionAggregate {
  queued: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
}

/** Aggregate the four states across a set of notes — the "N of M analysed" view during an import. */
export function aggregateExtractionStates(notes: Array<{ status: string; sweepAttempts?: number }>): ExtractionAggregate {
  const agg: ExtractionAggregate = { queued: 0, processing: 0, done: 0, failed: 0, total: notes.length };
  for (const n of notes) agg[extractionState(n)] += 1;
  return agg;
}
