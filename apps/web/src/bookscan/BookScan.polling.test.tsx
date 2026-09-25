/**
 * [BOOKSCAN-STREAM task 4] Polling lifecycle: the scan polls while working, STOPS on completion (a scan
 * that polls forever is a battery + cost problem), and shows correct state after a remount mid-scan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BookScan } from './BookScan.js';
import type { BookScanReport, BookScanItem } from './bookScanClient.js';

const finding = (quote: string): BookScanItem => ({
  kind: 'open_promise', id: quote, clientId: 'c1', clientName: 'Acme', headline: `did you ${quote}?`,
  receipt: { quote, date: '2026-08-01' }, framing: 'worth_checking',
});
const rep = (done: boolean, items: BookScanItem[] = []): BookScanReport => ({
  items, isEmpty: items.length === 0, message: 'm', invitation: 'export the next chat',
  scanProgress: { totalChats: 2, extractedChats: done ? 2 : 1, pendingChats: done ? 0 : 1, failedChats: 0, done },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Drain the two-stage effect chain (poll → setReport, then report → setShown → re-render). A fixed
// number of turns is non-deterministic under CPU load, so advance timers UNTIL a condition holds
// (bounded), which deterministically drains the effect chain however many turns it takes.
const flushUntil = async (cond: () => boolean, maxTurns = 30): Promise<void> => {
  for (let i = 0; i < maxTurns && !cond(); i++) await vi.advanceTimersByTimeAsync(0);
};

describe('[BOOKSCAN-STREAM] polling lifecycle', () => {
  it('polls while working and STOPS once the scan is done', async () => {
    const scan = vi.fn<() => Promise<BookScanReport | null>>()
      .mockResolvedValueOnce(rep(false)) // tick 1: still working
      .mockResolvedValue(rep(true));     // tick 2+: done
    render(<BookScan api={{ scan }} />);

    await vi.advanceTimersByTimeAsync(0);     // initial tick (working) → schedules the interval
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);  // tick 2: done → stop
    expect(scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000); // plenty more time…
    expect(scan).toHaveBeenCalledTimes(2);    // …but polling has stopped
  });

  it('[SCREEN-REVIEW] a restore refresh appends new findings below and never moves read ones', async () => {
    const A = finding('a'), B = finding('b'), C = finding('c');
    let items: BookScanItem[] = [A, B];
    const scan = vi.fn<() => Promise<BookScanReport | null>>(async () => rep(true, items));
    const { rerender } = render(<BookScan api={{ scan }} refreshSignal={0} />);
    await flushUntil(() => screen.queryAllByTestId('scan-item').length === 2);
    const before = screen.getAllByTestId('scan-item').map((el) => el.textContent);

    // A restore re-extracts the note → the server now also returns C, and RESORTS it to the front.
    // The remount would rebuild the list as [C, A, B]; a refresh signal must keep A, B put and append C.
    items = [C, A, B];
    rerender(<BookScan api={{ scan }} refreshSignal={1} />);
    await flushUntil(() => screen.queryAllByTestId('scan-item').length === 3);
    const after = screen.getAllByTestId('scan-item').map((el) => el.textContent);

    expect(after[0]).toBe(before[0]); // A unmoved
    expect(after[1]).toBe(before[1]); // B unmoved
    expect(after[2]).toContain('did you c?'); // C appended BELOW, despite the server sorting it first
  });

  it('keeps polling while still working (does not stop early)', async () => {
    const scan = vi.fn<() => Promise<BookScanReport | null>>().mockResolvedValue(rep(false));
    render(<BookScan api={{ scan }} />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(3); // still polling
  });

  it('shows correct current state after a remount mid-scan (not a stale snapshot)', async () => {
    const scan1 = vi.fn<() => Promise<BookScanReport | null>>().mockResolvedValue(rep(false, [finding('send the quote')]));
    const first = render(<BookScan api={{ scan: scan1 }} />);
    await flushUntil(() => screen.queryAllByText(/send the quote/i).length > 0);
    expect(screen.getAllByText(/send the quote/i).length).toBeGreaterThan(0);
    first.unmount(); // leaving the screen clears the interval

    // Coming back: a fresh mount re-fetches and shows the NOW-current (finished) state.
    const scan2 = vi.fn<() => Promise<BookScanReport | null>>().mockResolvedValue(rep(true, [finding('send the quote'), finding('call them back')]));
    render(<BookScan api={{ scan: scan2 }} />);
    await flushUntil(() => screen.queryAllByText(/call them back/i).length > 0);
    expect(scan2).toHaveBeenCalled();
    expect(screen.getAllByText(/call them back/i).length).toBeGreaterThan(0); // current state, not stale
    expect(screen.queryByTestId('scan-progress')).toBeNull(); // finished → no scanning indicator
  });
});
