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

  // [SCREEN-REVIEW] the persistent held indicator appears wherever the note appears, so a rep who
  // skipped review knows this note isn't fully analysed.
  it('shows the persistent held indicator when a note has held messages', () => {
    render(<NotesTimeline notes={[note({ held: 4 })]} ceilingNoteIds={new Set()} />);
    expect(screen.getByTestId('held-notice')).toHaveTextContent(/4 messages held.*not yet analysed/i);
  });
  it('shows no held indicator when nothing is held', () => {
    render(<NotesTimeline notes={[note({})]} ceilingNoteIds={new Set()} />);
    expect(screen.queryByTestId('held-notice')).toBeNull();
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
});
