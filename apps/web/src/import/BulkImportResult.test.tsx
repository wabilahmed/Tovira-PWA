import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkImportResult } from './BulkImportResult.js';

const jobs = [
  { key: 'a.txt', state: 'done' as const },
  { key: 'b.txt', state: 'failed_usage_limit' as const },
  { key: 'c.txt', state: 'failed_usage_limit' as const },
];

describe('<BulkImportResult>', () => {
  // [P20-3 / BULK-08] One summary + one "Open Book Scan" for the whole batch.
  it('[P20-3] shows the batch summary and an Open Book Scan button', async () => {
    const onOpenBookScan = vi.fn();
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'done' as const }, { key: 'b.txt', state: 'done' as const }]} summary={{ chatsImported: 2, promises: 5, requirements: 3 }} onOpenBookScan={onOpenBookScan} />);
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('Imported 2 chats. Found 5 promises, 3 requirements.') /* [P40-4 · owner] */;
    await userEvent.click(screen.getByRole('button', { name: /open book scan/i }));
    expect(onOpenBookScan).toHaveBeenCalled();
  });

  it('[P20-3] singularises a one-chat / one-fact summary', () => {
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'done' as const }]} summary={{ chatsImported: 1, promises: 1, requirements: 0 }} />);
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('Imported 1 chat. Found 1 promise, 0 requirements.');
  });

  it('shows a row per chat; a usage-limited row reads the exact ruling copy', () => {
    render(<BulkImportResult jobs={jobs} />);
    expect(screen.getAllByTestId(/^result-row-/)).toHaveLength(3);
    expect(within(screen.getByTestId('result-row-b.txt')).getByText('Not imported. No messages were left this month.')).toBeInTheDocument(); // [P83] messages
  });

  // [P37] the packs open Settings → Subscription (the purchase screen). [P83 · owner] pins moved to messages.
  it('summarises the chats not imported and invites a re-upload after adding messages', async () => {
    const onOpenSubscription = vi.fn();
    render(<BulkImportResult jobs={jobs} upsell={{ shortfall: true, n: 2, canTopUp: true, recommendedOptionId: 'topup_50', options: [
      { id: 'topup_50', label: '+1,500 messages', messages: 1500 },
      { id: 'topup_100', label: '+3,000 messages', messages: 3000 },
    ] }} onOpenSubscription={onOpenSubscription} />);
    expect(screen.getByText(/2 chats weren.t imported because no messages were left this month/i)).toBeInTheDocument();
    expect(screen.getByText('Add messages, then re-upload the ones not imported.')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('topup-recommended'));
    expect(onOpenSubscription).toHaveBeenCalled();
  });

  it('a trial sees Subscribe now + the allowance-reset line on the result, not top-ups', async () => {
    const onSubscribe = vi.fn();
    render(<BulkImportResult jobs={jobs} upsell={{ shortfall: true, n: 2, canTopUp: false, recommendedOptionId: null, options: [] }} onSubscribe={onSubscribe} />);
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent('Subscribing gives you 10,000 messages a month.'); // [P37 · owner] was "…to the full AED 60."; [P83] in messages
    // [P90-3 · owner, Prompt 88] moved: the annual plan is hidden until its checkout is proven, so the prompt offers monthly only
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  it('an interrupted chat reads the re-upload copy (FIX 3)', () => {
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'failed_interrupted' }]} />);
    expect(within(screen.getByTestId('result-row-a.txt')).getByText(/not imported\. something went wrong\. please re-upload this chat\./i)).toBeInTheDocument();
  });

  it('no limit message when every chat imported', () => {
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'done' }, { key: 'b.txt', state: 'done' }]} />);
    expect(screen.queryByText(/weren.t imported/i)).toBeNull();
    expect(screen.queryByTestId('bulk-upsell')).toBeNull();
  });
});
