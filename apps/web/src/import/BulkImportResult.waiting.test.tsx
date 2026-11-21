import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BulkImportResult } from './BulkImportResult.js';

// [P83 · owner] A chat stored but with more messages to read than are left waits (it is read once messages are added);
// it is never shown as failed, and the copy speaks in messages.
describe('[P83] a chat waiting for messages', () => {
  it('reads "Saved. Tovira reads it as soon as you add messages." and is counted as waiting', () => {
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'waiting_messages' }, { key: 'b.txt', state: 'done' }]} upsell={{ shortfall: true, n: 1, canTopUp: true, recommendedOptionId: 'topup_50', options: [{ id: 'topup_50', label: '+1,500 messages', messages: 1500 }] }} />);
    expect(within(screen.getByTestId('result-row-a.txt')).getByText('Saved. Tovira reads it as soon as you add messages.')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-waiting')).toHaveTextContent('1 chat is saved and waiting: more messages to read than you have left this month.');
    expect(screen.getByText('Add messages and Tovira reads them straight away.')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-import-result').textContent).not.toMatch(/AED|%|usage/i);
  });
});
