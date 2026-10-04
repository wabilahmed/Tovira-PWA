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
  it('shows a row per chat; a usage-limited row reads the exact ruling copy', () => {
    render(<BulkImportResult jobs={jobs} />);
    expect(screen.getAllByTestId(/^result-row-/)).toHaveLength(3);
    expect(within(screen.getByTestId('result-row-b.txt')).getByText(/not imported\. you reached your monthly usage limit\./i)).toBeInTheDocument();
  });

  it('summarises the limit failures and invites a re-upload after topping up', async () => {
    const onTopUp = vi.fn();
    render(<BulkImportResult jobs={jobs} upsell={{ shortfall: true, n: 2, canTopUp: true, recommendedOptionId: 'topup_25', options: [
      { id: 'topup_15', label: '+15%', priceAed: 50 },
      { id: 'topup_25', label: '+25%', priceAed: 65 },
    ] }} onTopUp={onTopUp} />);
    expect(screen.getByText(/2 chats weren.t imported because you reached your monthly usage limit/i)).toBeInTheDocument();
    expect(screen.getByText(/re-upload them after topping up/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('topup-recommended'));
    expect(onTopUp).toHaveBeenCalledWith('topup_25');
  });

  it('a trial sees Subscribe on the result, not top-ups', () => {
    const onSubscribe = vi.fn();
    render(<BulkImportResult jobs={jobs} upsell={{ shortfall: true, n: 2, canTopUp: false, recommendedOptionId: null, options: [] }} onSubscribe={onSubscribe} />);
    expect(screen.getByRole('button', { name: /subscribe to keep importing/i })).toBeInTheDocument();
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
