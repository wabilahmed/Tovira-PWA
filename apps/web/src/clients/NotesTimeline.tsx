import type { ReactNode } from 'react';
import type { NoteSummary } from './clientsClient.js';
import { CeilingNotice } from '../import/CeilingNotice.js';

function isProcessing(status: string): boolean {
  return status === 'pending_transcription' || status === 'pending_extraction';
}
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
        return (
          <li key={n.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--hairline)' }}>
            <small style={{ color: 'var(--text-tertiary)' }}>
              {new Date(n.createdAt).toLocaleString()} · {n.source}
              {!ceiling && isProcessing(n.status) && <em style={{ color: 'var(--amber)' }}> · {processingLabel(n.status)}</em>}
            </small>
            <div>{n.rawText ?? <em>(transcription pending)</em>}</div>
            {ceiling && <CeilingNotice />}
            {!ceiling && n.rawText && renderFollowUp?.(n.id)}
          </li>
        );
      })}
    </ul>
  );
}
