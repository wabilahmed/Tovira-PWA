import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PointersCard, type Pointer } from './PointersCard.js';

const P = (o: Partial<Pointer> & { text: string }): Pointer => ({ section: 'relationship', receipts: [{ source_span: 'q', source_message_at: '2026-01-01T10:00' }], ...o });

describe('<PointersCard>', () => {
  // [P36-5] owner copy (20 Oct): "Building the relationship" / "Closing the sale" (was "To build the relationship:" /
  // "To close the sale:"); an inferred pointer reads "Tovira's read" (was "(our read)").
  it('renders the template heading + both sections (open deal → Closing the sale)', () => {
    render(<PointersCard clientName="Layla" pointers={[P({ text: "don't push on timeline" }), P({ section: 'close', text: 'offer the Marina unit' })]} disclosure={null} />);
    // [P46-4 · owner] the line repeated the section heading ("Before your next meeting"); it is gone
    expect(screen.queryByText(/in your next meeting with layla, keep these in mind/i)).toBeNull();
    expect(screen.getByText('Building the relationship')).toBeInTheDocument();
    expect(screen.getByText('Closing the sale')).toBeInTheDocument();
    expect(screen.getByText(/offer the marina unit/i)).toBeInTheDocument();
  });

  // [P18-4] A receipt's date is the SOURCE MESSAGE date, and it must be formatted — never a raw ISO string.
  it('[P18-4] shows the message date formatted on a receipt, never a raw ISO timestamp', () => {
    const { container } = render(
      <PointersCard
        clientName="Layla"
        pointers={[P({ text: 'follow up on pricing', receipts: [{ source_span: 'see you Tuesday', source_message_at: '2026-03-05T09:00:00.000Z' }] })]}
        disclosure={null}
      />,
    );
    expect(container.textContent).toContain('5 Mar 2026');            // the message date, formatted ([P35-3] the chat's date chip)
    expect(container.textContent).not.toContain('2026-03-05T09:00');  // not the raw ISO timestamp
  });

  it('labels an inferred pointer', () => {
    render(<PointersCard clientName="Layla" pointers={[P({ text: 'seemed irritated when pushed', inferred: true })]} disclosure={null} />);
    expect(screen.getByText(/Tovira's read/)).toBeInTheDocument();
    expect(screen.queryByText(/our read/i)).toBeNull();
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

// [P46-4] Owner: "In your next meeting with X, keep these in mind." repeated the "Before your next meeting" heading.
describe('[P46-4] no duplicate line', () => {
  it('NEGATIVE: the card never repeats the heading', () => {
    const { container } = render(<PointersCard clientName="Sara" pointers={[P({ text: 'prefers calls' })]} disclosure={null} />);
    expect(container.textContent).not.toMatch(/in your next meeting with|keep these in mind/i);
  });
});
