import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask } from './Ask.js';
import type { RecallAnswer } from './recallClient.js';

/** [P21-A3] A held statement reads "Saved for confirmation: Sara's budget → 2.2M · Confirm" — one line,
 *  one tap — and an ambiguous one shows the server's "which client?" question, not a second message. */
describe('[P21-A3] <Ask> saved-for-confirmation reply', () => {
  const held: RecallAnswer = {
    answer: "Saved for confirmation: Sara's budget → 2.2M", receipts: [],
    capture: { status: 'captured', statement: 'Remember that QA Sara Khan increased her budget to 2.2M', clientName: 'QA Sara Khan', noteId: 'n9', summary: "Sara's budget → 2.2M" },
  };

  it('shows "Saved for confirmation: <summary>" with a Confirm button, once', async () => {
    const user = userEvent.setup();
    const confirmCapture = vi.fn().mockResolvedValue(true);
    render(<Ask api={{ ask: vi.fn().mockResolvedValue(held), confirmCapture, rejectCapture: vi.fn() }} />);
    await user.type(screen.getByLabelText('Your question'), 'Remember that QA Sara Khan increased her budget to 2.2M');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const line = await screen.findByText(/Saved for confirmation: Sara's budget → 2\.2M/);
    expect(screen.getAllByText(/Saved for confirmation/)).toHaveLength(1); // not repeated by the answer block
    expect(line.closest('[role="group"]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmCapture).toHaveBeenCalledWith('n9'));
    await screen.findByText(/Added to QA Sara Khan record\./i);
  });

  it('needs_client: shows the server\'s which-client question (once), no Confirm button', async () => {
    const user = userEvent.setup();
    const ans: RecallAnswer = { answer: 'Which client is this about — Sara Khan or Sara Malik? Nothing was saved.', receipts: [], capture: { status: 'needs_client', statement: 'x', candidates: ['Sara Khan', 'Sara Malik'] } };
    render(<Ask api={{ ask: vi.fn().mockResolvedValue(ans), confirmCapture: vi.fn(), rejectCapture: vi.fn() }} />);
    await user.type(screen.getByLabelText('Your question'), 'Remember that Sara increased her budget');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText(/Sara Khan or Sara Malik/);
    expect(screen.getAllByText(/Which client is this about/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});
