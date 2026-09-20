import { describe, it, expect } from 'vitest';
import { extractionState, aggregateExtractionStates } from './extraction-state.js';

describe('[ASYNC-EXTRACT] extractionState — four unambiguous, rep-facing states', () => {
  it('queued: captured but not yet attempted', () => {
    expect(extractionState({ status: 'pending_extraction', sweepAttempts: 0 })).toBe('queued');
    expect(extractionState({ status: 'pending_transcription', sweepAttempts: 0 })).toBe('queued');
    expect(extractionState({ status: 'pending_extraction' })).toBe('queued'); // no attempts field
  });

  it('processing: the sweep has picked it up (attempt in flight)', () => {
    expect(extractionState({ status: 'pending_extraction', sweepAttempts: 1 })).toBe('processing');
    expect(extractionState({ status: 'pending_transcription', sweepAttempts: 3 })).toBe('processing');
  });

  it('done: extracted', () => {
    expect(extractionState({ status: 'extracted', sweepAttempts: 1 })).toBe('done');
  });

  // The load-bearing rule: a terminal failure reads as FAILED, never as still-processing/stuck.
  it('failed: needs_review and import_failed both surface as failed', () => {
    expect(extractionState({ status: 'needs_review', sweepAttempts: 5 })).toBe('failed');
    expect(extractionState({ status: 'import_failed', sweepAttempts: 0 })).toBe('failed');
  });

  it('an unknown non-terminal state waits (queued), never a silent "processing"', () => {
    expect(extractionState({ status: 'pending_confirmation', sweepAttempts: 0 })).toBe('queued');
  });

  it('aggregates the states across an import', () => {
    const agg = aggregateExtractionStates([
      { status: 'pending_extraction', sweepAttempts: 0 },
      { status: 'pending_extraction', sweepAttempts: 2 },
      { status: 'extracted', sweepAttempts: 1 },
      { status: 'extracted', sweepAttempts: 1 },
      { status: 'needs_review', sweepAttempts: 5 },
    ]);
    expect(agg).toEqual({ queued: 1, processing: 1, done: 2, failed: 1, total: 5 });
  });
});
