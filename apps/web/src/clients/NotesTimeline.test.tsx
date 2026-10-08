import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotesTimeline } from './NotesTimeline.js';
import type { NoteSummary } from './clientsClient.js';

const note = (over: Partial<NoteSummary>): NoteSummary => ({
  id: 'n1', source: 'paste', rawText: 'hello', status: 'extracted', createdAt: Date.parse('2026-08-01T10:00:00Z'), ...over,
});

describe('<NotesTimeline> (P5-1-CEILING-UI)', () => {
  it('shows an extracted note with its text', () => {
    render(<NotesTimeline notes={[note({ rawText: 'the quote is ready' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/the quote is ready/i)).toBeInTheDocument();
  });

  it('shows the normal "analysing…" state for a pending note', () => {
    render(<NotesTimeline notes={[note({ status: 'pending_extraction' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/analysing/i)).toBeInTheDocument();
  });

  // A ceiling-blocked note shows the non-scary state — saved, waiting, upgrade —
  // and NOT the ordinary "analysing…" spinner (it isn't being analysed).
  it('shows the non-scary ceiling state for a ceiling-blocked note', () => {
    render(<NotesTimeline notes={[note({ id: 'nX', status: 'pending_extraction' })]} ceilingNoteIds={new Set(['nX'])} />);
    expect(screen.getByTestId('ceiling-notice')).toBeInTheDocument();
    expect(screen.queryByText(/analysing/i)).toBeNull();
  });

  // [ASYNC-EXTRACT] a failed extraction surfaces as failed — never a silent spinner.
  it('shows a distinct, honest reason for a note whose recording was not found (not "tap to retry")', () => {
    render(<NotesTimeline notes={[note({ status: 'transcription_failed', rawText: null })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByTestId('transcription-failed')).toBeInTheDocument();
    expect(screen.getByText(/recording could.?n.t be found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('extract-failed')).not.toBeInTheDocument(); // not the generic retry message
    expect(screen.queryByText(/transcription pending/i)).not.toBeInTheDocument(); // not shown as still pending
  });

  it('shows a distinct FAILED state for a note whose extraction failed', () => {
    render(<NotesTimeline notes={[note({ status: 'needs_review', extractionState: 'failed' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByTestId('extract-failed')).toBeInTheDocument();
    expect(screen.queryByText(/analysing/i)).toBeNull(); // not stuck-looking
  });

  it('distinguishes queued from processing', () => {
    const { rerender } = render(<NotesTimeline notes={[note({ status: 'pending_extraction', extractionState: 'queued' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
    rerender(<NotesTimeline notes={[note({ status: 'pending_extraction', extractionState: 'processing' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/analysing/i)).toBeInTheDocument();
  });

  it('renders an empty state when there are no notes', () => {
    render(<NotesTimeline notes={[]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  // [AUDIT item 6] A note withheld during an erasure review must say WHY, not read as a blank/pending
  // note. The server withholds the content (rawText null) and flags it; the book must show the notice.
  it('shows the privacy-restriction notice for a restricted note (not a blank/pending look)', () => {
    render(<NotesTimeline notes={[note({ rawText: null, restricted: true, restrictionNotice: 'Restricted while a privacy request is reviewed.' })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByTestId('note-restricted')).toHaveTextContent(/restricted while a privacy request is reviewed/i);
    expect(screen.queryByText(/transcription pending/i)).toBeNull(); // not mistaken for a pending note
  });
});
