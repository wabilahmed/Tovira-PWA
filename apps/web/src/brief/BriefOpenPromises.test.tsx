import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefOpenPromises, type BriefPromise } from './BriefOpenPromises.js';

const promise = (over: Partial<BriefPromise> = {}): BriefPromise => ({
  id: 'p1', text: 'send the revised quote', dueDate: '2026-08-01', dueRaw: 'Friday', ...over,
});

describe('[P18-10b] <BriefOpenPromises>', () => {
  it('shows each open promise with its due date', () => {
    render(<BriefOpenPromises promises={[promise()]} />);
    expect(screen.getByText(/send the revised quote/)).toBeInTheDocument();
    expect(screen.getByText(/due 1 Aug 2026/)).toBeInTheDocument();
  });

  it('renders the receipt (verbatim quote + date) when the promise carries one', () => {
    render(<BriefOpenPromises promises={[promise({ receipt: { quote: "I'll send the revised quote Friday", source: 'message', at: '2026-07-28T09:00:00.000Z', label: '' } })]} />);
    expect(screen.getByTestId('receipt')).toHaveTextContent("I'll send the revised quote Friday");
    expect(screen.getByTestId('receipt')).toHaveTextContent(/28 JUL 2026/);
  });

  it('shows NO receipt chit for a promise that predates receipts (no stored quote) — never fabricates one', () => {
    render(<BriefOpenPromises promises={[promise({ receipt: { quote: null, source: 'none', at: null, label: 'No source quote was saved for this fact' } })]} />);
    expect(screen.queryByTestId('receipt')).toBeNull();
  });

  it('renders nothing when there are no open promises', () => {
    const { container } = render(<BriefOpenPromises promises={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
