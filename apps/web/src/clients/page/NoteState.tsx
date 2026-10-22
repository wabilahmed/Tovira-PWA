import type { NoteSummary } from '../clientsClient.js';
import { extractionStateOf } from '../clientsClient.js';

/**
 * [P36-5] A note's pipeline state and its billing hold, shown with each conversation on the client page
 * (moved here from the retired notes timeline): queued / analysing / held by billing / failed — never an endless
 * spinner, and a missing recording is its own honest reason.
 */
function processingLabel(status: string): string {
  return status === 'pending_transcription' ? 'transcribing…' : 'analysing…';
}

/** [IMP-17] A pending note that billing is holding reads as SAVED with the reason + the way out — never
 *  an endless "queued…". Copy mirrors the three lock reasons (subscribe / update card / top up). */
function blockedMessage(reason: 'subscribe' | 'payment' | 'allowance'): string {
  if (reason === 'payment') return 'Saved. It will be read once your payment is updated.';
  if (reason === 'allowance') return 'Saved. It will be read once you top up.';
  return 'Saved. It will be read once you subscribe.';
}

/** [P36-5] A note's pipeline state, inline after its stamp (queued / analysing / held by billing / failed).
 *  Shared by the timeline and the client page's Conversations. Nothing when the note is settled. */
export function NoteState({ note: n, ceiling }: { note: NoteSummary; ceiling: boolean }): JSX.Element | null {
  if (ceiling) return null;
  const state = extractionStateOf(n);
  const inProgress = state === 'queued' || state === 'processing';
  if (inProgress) {
    return n.blockedReason
      ? <em data-testid="note-blocked" style={{ color: 'var(--text-secondary)', fontStyle: 'normal' }}> · {blockedMessage(n.blockedReason)}</em>
      : <em style={{ color: 'var(--amber)', fontStyle: 'normal' }}> · {state === 'queued' ? 'queued…' : processingLabel(n.status)}</em>;
  }
  // [ASYNC-EXTRACT] a failure reads as failed — never an endless spinner. [TRANSCRIBE-MISSING] a missing
  // recording is a DISTINCT, honest reason — not "tap to retry" (retry can't find it).
  if (state === 'failed' && n.status === 'transcription_failed') {
    return <em data-testid="transcription-failed" style={{ color: 'var(--danger)', fontStyle: 'normal' }}> · recording not found — couldn’t transcribe</em>;
  }
  if (state === 'failed') return <em data-testid="extract-failed" style={{ color: 'var(--danger)', fontStyle: 'normal' }}> · couldn’t analyse — saved; tap to retry</em>;
  return null;
}

/** [IMP-17] A trial/ended rep gets a Subscribe CTA right on the held note; payment/allowance reps are told the
 *  reason and manage it from Billing (the global banner carries those CTAs). */
export function NoteSubscribe({ note: n, ceiling, onSubscribe }: { note: NoteSummary; ceiling: boolean; onSubscribe?: (plan: 'monthly' | 'annual') => void }): JSX.Element | null {
  const state = extractionStateOf(n);
  const inProgress = state === 'queued' || state === 'processing';
  if (ceiling || !inProgress || n.blockedReason !== 'subscribe' || !onSubscribe) return null;
  return (
    <div style={{ marginTop: 'var(--space-1)' }}>
      <button type="button" className="tov-link" data-testid="note-subscribe" onClick={() => onSubscribe('monthly')}>Subscribe to read it</button>
    </div>
  );
}
