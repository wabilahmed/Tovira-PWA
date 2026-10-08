import type { ReactNode } from 'react';
import type { NoteSummary } from './clientsClient.js';
import { extractionStateOf } from './clientsClient.js';
import { CeilingNotice } from '../import/CeilingNotice.js';
import { MoveNoteControl, type MoveNoteApi } from '../notes/MoveNoteControl.js';
import type { ClientOption } from '../meetings/Meetings.js';

function processingLabel(status: string): string {
  return status === 'pending_transcription' ? 'transcribing…' : 'analysing…';
}

/**
 * The per-client notes timeline. A note whose extraction was stopped by the trial
 * seeding ceiling (`ceilingNoteIds`, learned from the server) shows the non-scary
 * ceiling state instead of the ordinary "analysing…" spinner — its chat is saved,
 * just waiting on an upgrade. No client-side ceiling math happens here.
 */
export function NotesTimeline({
  notes,
  ceilingNoteIds,
  renderFollowUp,
  move,
}: {
  notes: NoteSummary[];
  ceilingNoteIds: Set<string>;
  renderFollowUp?: (noteId: string) => ReactNode;
  /** [NOTE-MOVE] when present, each settled note gets a "Move to another client" control. */
  move?: { api: MoveNoteApi; clientId: string; clients: ClientOption[]; onMoved?: (noteId: string) => void };
}): JSX.Element {
  if (notes.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>No notes yet.</p>;

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {notes.map((n) => {
        const ceiling = ceilingNoteIds.has(n.id);
        const state = extractionStateOf(n);
        const inProgress = state === 'queued' || state === 'processing';
        return (
          <li key={n.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--hairline)' }}>
            <small className="tov-stamp">
              {new Date(n.createdAt).toLocaleString()} · {n.source}
              {!ceiling && inProgress && <em style={{ color: 'var(--amber)', fontStyle: 'normal' }}> · {state === 'queued' ? 'queued…' : processingLabel(n.status)}</em>}
              {/* [ASYNC-EXTRACT] a failure reads as failed — never an endless spinner. [TRANSCRIBE-MISSING]
                  a missing recording is a DISTINCT, honest reason — not "tap to retry" (retry can't find it). */}
              {!ceiling && state === 'failed' && n.status === 'transcription_failed' && (
                <em data-testid="transcription-failed" style={{ color: 'var(--danger, #b00)', fontStyle: 'normal' }}> · recording not found — couldn’t transcribe</em>
              )}
              {!ceiling && state === 'failed' && n.status !== 'transcription_failed' && (
                <em data-testid="extract-failed" style={{ color: 'var(--danger, #b00)', fontStyle: 'normal' }}> · couldn’t analyse — saved; tap to retry</em>
              )}
            </small>
            <div style={{ marginTop: 4 }}>
              {n.restricted ? (
                <em data-testid="note-restricted" style={{ color: 'var(--text-secondary)' }}>
                  {n.restrictionNotice ?? 'Restricted while a privacy request is reviewed.'}
                </em>
              ) : (
                n.rawText ?? <em>{n.status === 'transcription_failed' ? 'The recording couldn’t be found, so this note couldn’t be transcribed.' : '(transcription pending)'}</em>
              )}
            </div>
            {ceiling && <CeilingNotice />}
            {!ceiling && n.rawText && renderFollowUp?.(n.id)}
            {/* [NOTE-MOVE] a settled note can be moved to the right client if it was misfiled. */}
            {!ceiling && !inProgress && !n.restricted && move && (
              <MoveNoteControl api={move.api} noteId={n.id} fromClientId={move.clientId} clients={move.clients} onMoved={move.onMoved} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
