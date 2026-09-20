import type { ReactNode } from 'react';
import type { NoteSummary } from './clientsClient.js';
import { extractionStateOf } from './clientsClient.js';
import { CeilingNotice } from '../import/CeilingNotice.js';

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
}: {
  notes: NoteSummary[];
  ceilingNoteIds: Set<string>;
  renderFollowUp?: (noteId: string) => ReactNode;
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
              {/* [ASYNC-EXTRACT] a failure reads as failed — never an endless spinner. */}
              {!ceiling && state === 'failed' && (
                <em data-testid="extract-failed" style={{ color: 'var(--danger, #b00)', fontStyle: 'normal' }}> · couldn’t analyse — saved; tap to retry</em>
              )}
            </small>
            <div style={{ marginTop: 4 }}>{n.rawText ?? <em>(transcription pending)</em>}</div>
            {ceiling && <CeilingNotice />}
            {!ceiling && n.rawText && renderFollowUp?.(n.id)}
          </li>
        );
      })}
    </ul>
  );
}
