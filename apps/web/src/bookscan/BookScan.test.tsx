import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookScan, type BookScanApi } from './BookScan.js';
import type { BookScanReport } from './bookScanClient.js';

const api = (report: BookScanReport | null): BookScanApi => ({ scan: vi.fn().mockResolvedValue(report) });

const FULL: BookScanReport = {
  isEmpty: false,
  message: null,
  invitation: 'Export your next chat and I’ll X-ray that one too.',
  items: [
    {
      kind: 'open_promise',
      id: 'p1',
      clientId: 'c1',
      clientName: 'Acme',
      headline: 'Worth checking: did you send the revised quote?',
      receipt: { quote: 'send the revised quote', date: '2026-08-01' },
      framing: 'worth_checking',
    },
    {
      kind: 'unanswered_question',
      id: 'q1',
      clientId: 'c2',
      clientName: 'Sara Lee',
      headline: 'Sara Lee asked something and the thread went quiet',
      receipt: { quote: 'Can you do bulk pricing?', date: '2026-01-16T10:00:00' },
      framing: 'worth_checking',
    },
  ],
};

// [BOOKSCAN-STREAM task 2] progress that cannot be mistaken for completion.
describe('<BookScan> streaming progress', () => {
  const prog = (over: Partial<NonNullable<BookScanReport['scanProgress']>>) => ({
    totalChats: 3, extractedChats: 0, pendingChats: 3, failedChats: 0, done: false, ...over,
  });

  it('mid-scan with zero findings renders the SCANNING state, not the empty state', async () => {
    render(<BookScan api={api({ items: [], isEmpty: true, message: 'Not much here yet.', invitation: 'x', scanProgress: prog({ extractedChats: 1, pendingChats: 2 }) })} />);
    expect(await screen.findByTestId('scan-progress')).toBeInTheDocument();
    expect(screen.getByTestId('scan-progress')).toHaveTextContent(/analysed 1 of 3/i);
    expect(screen.queryByText(/not much here yet/i)).toBeNull(); // NOT the empty state
  });

  it('completed with zero findings renders the empty state (genuinely nothing found)', async () => {
    render(<BookScan api={api({ items: [], isEmpty: true, message: 'Not much here yet.', invitation: 'x', scanProgress: prog({ extractedChats: 3, pendingChats: 0, done: true }) })} />);
    expect(await screen.findByText(/not much here yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('scan-progress')).toBeNull(); // finished — no scanning indicator
  });

  it('a failed extraction is visible in progress, not dropped', async () => {
    render(<BookScan api={api({ items: [], isEmpty: true, message: 'x', invitation: 'x', scanProgress: prog({ totalChats: 3, extractedChats: 1, pendingChats: 1, failedChats: 1 }) })} />);
    const bar = await screen.findByTestId('scan-progress');
    expect(bar).toHaveTextContent(/analysed 1 of 3/i); // failed still in the denominator (of 3)
    expect(bar).toHaveTextContent(/1 couldn’t be read/i);
  });
});

describe('<BookScan>', () => {
  it('shows a loading state first', () => {
    render(<BookScan api={api(FULL)} />);
    expect(screen.getByText(/scanning your history/i)).toBeInTheDocument();
  });

  it('renders each finding with its headline, kind, and invitation', async () => {
    render(<BookScan api={api(FULL)} />);
    expect(await screen.findByText(/thread went quiet/i)).toBeInTheDocument();
    expect(screen.getByText('Worth checking: did you send the revised quote?')).toBeInTheDocument();
    expect(screen.getByText(/export your next chat/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('scan-item')).toHaveLength(2);
  });

  // TRUST RULE: every rendered item shows its receipt (a quote). Asserted over all.
  it('never renders an item without a receipt quote', async () => {
    render(<BookScan api={api(FULL)} />);
    await screen.findByText(/thread went quiet/i);
    const receipts = screen.getAllByTestId('receipt');
    expect(receipts).toHaveLength(FULL.items.length);
    for (const r of receipts) expect(r.textContent?.trim().length).toBeGreaterThan(1);
  });

  it('marks promises as "worth checking" (never accusatory)', async () => {
    render(<BookScan api={api(FULL)} />);
    await screen.findByText(/thread went quiet/i);
    expect(screen.getAllByText(/worth checking/i).length).toBeGreaterThan(0);
  });

  it('shows the honest empty state when there is nothing to reveal', async () => {
    render(<BookScan api={api({ items: [], isEmpty: true, message: 'Not much here yet — export another chat.', invitation: 'Export a chat.' })} />);
    expect(await screen.findByText(/not much here yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('scan-item')).toBeNull();
  });

  // NEGATIVE: a failed scan surfaces an error, not a blank or fabricated screen.
  it('shows an error when the scan fails', async () => {
    render(<BookScan api={api(null)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t run the scan/i);
  });
});
