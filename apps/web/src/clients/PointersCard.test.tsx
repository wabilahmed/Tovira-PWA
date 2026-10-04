import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PointersCard, type Pointer } from './PointersCard.js';

const P = (o: Partial<Pointer> & { text: string }): Pointer => ({ section: 'relationship', receipts: [{ source_span: 'q', source_message_at: '2026-01-01T10:00' }], ...o });

describe('<PointersCard>', () => {
  it('renders the template heading + both sections (open deal → To close the sale)', () => {
    render(<PointersCard clientName="Layla" pointers={[P({ text: "don't push on timeline" }), P({ section: 'close', text: 'offer the Marina unit' })]} disclosure={null} />);
    expect(screen.getByText(/in your next meeting with layla, keep these in mind/i)).toBeInTheDocument();
    expect(screen.getByText(/to build the relationship:/i)).toBeInTheDocument();
    expect(screen.getByText(/to close the sale:/i)).toBeInTheDocument();
    expect(screen.getByText(/offer the marina unit/i)).toBeInTheDocument();
  });

  it('labels an inferred pointer', () => {
    render(<PointersCard clientName="Layla" pointers={[P({ text: 'seemed irritated when pushed', inferred: true })]} disclosure={null} />);
    expect(screen.getByText(/our read/i)).toBeInTheDocument();
  });

  it('renders the retrospective heading + the exact disclosure for a confirmed loss', () => {
    render(<PointersCard clientName="Omar" pointers={[P({ section: 'retrospective', text: 'price was never competitive' })]} disclosure="This is our best reading of what happened, based on your messages. It may not be accurate." />);
    expect(screen.getByText(/what we think went wrong:/i)).toBeInTheDocument();
    expect(screen.getByText(/this is our best reading of what happened, based on your messages\. it may not be accurate\./i)).toBeInTheDocument();
  });

  it('won → Next opportunity', () => {
    render(<PointersCard clientName="Sara" pointers={[P({ section: 'next_opportunity', text: 'ask for a referral' })]} disclosure={null} />);
    expect(screen.getByText(/next opportunity:/i)).toBeInTheDocument();
  });

  it('empty set → the short-chat line, no section headings', () => {
    render(<PointersCard clientName="Khalid" pointers={[]} disclosure={null} />);
    expect(screen.getByText(/this chat is short, so only a couple of things stood out\./i)).toBeInTheDocument();
    expect(screen.queryByText(/to build the relationship:/i)).toBeNull();
  });
});
