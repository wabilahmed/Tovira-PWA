import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChitQueue, type ConfirmQueueApi, type KeptQueueApi } from './ConfirmChitQueue.js';

/** [P24-2] "Looks like you sent the options to QA P14 Gate Client. Mark done?" in To Confirm: both receipts,
 *  Mark done (with Undo) and Not yet. Nothing closes the promise without the rep's tap. */
const none: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([]), confirm: vi.fn(), reject: vi.fn() };
const S = {
  id: 's1', promiseId: 'p1', clientId: 'c1', clientName: 'QA P14 Gate Client',
  message: 'Looks like you sent the options to QA P14 Gate Client. Mark done?',
  promise: { quote: "I'll send you three options by Thursday", date: '2026-03-02' },
  delivery: { quote: 'Here are the options', date: '2026-03-05' },
};
function kept(): KeptQueueApi & { [k: string]: ReturnType<typeof vi.fn> } {
  return { listKept: vi.fn().mockResolvedValue([S]), markKeptDone: vi.fn().mockResolvedValue(true), undoKept: vi.fn().mockResolvedValue(true), notYetKept: vi.fn().mockResolvedValue(true) } as never;
}

describe('[P24-2] <ConfirmChitQueue> kept-promise suggestion', () => {
  it('shows the copy and BOTH receipts (promise + delivery, dated) with Mark done / Not yet', async () => {
    render(<ConfirmChitQueue api={none} kept={kept()} />);
    const card = await screen.findByRole('group', { name: /looks sent/i });
    expect(within(card).getByText('Looks like you sent the options to QA P14 Gate Client. Mark done?')).toBeInTheDocument();
    // [P35-3] the promise as a chat bubble by default; a tap shows the conversation AND the delivery message,
    // each dated by the chat's date chip (shown once per day).
    await within(card).findByText(/I'll send you three options by Thursday/);
    await userEvent.click(within(card).getByRole('button', { name: /show the conversation/i }));
    expect(await within(card).findByText(/Here are the options/)).toBeInTheDocument();
    expect(card.textContent).toContain('2 Mar 2026');
    expect(card.textContent).toContain('5 Mar 2026');
    expect(within(card).getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Not yet' })).toBeInTheDocument();
  });

  it('Mark done → closes it with an Undo; Undo brings it back', async () => {
    const api = kept();
    render(<ConfirmChitQueue api={none} kept={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(api.markKeptDone).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.queryByRole('group', { name: /looks sent/i })).toBeNull()); // [P34-7] the card, not a now-collapsed quote
    const toast = await screen.findByTestId('kept-undo');
    expect(toast.textContent).toMatch(/Marked done/);
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(api.undoKept).toHaveBeenCalledWith('s1');
    expect(await screen.findByRole('group', { name: /looks sent/i })).toBeInTheDocument();
  });

  it('Not yet → dismissed, no Undo toast, promise untouched', async () => {
    const api = kept();
    render(<ConfirmChitQueue api={none} kept={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not yet' }));
    expect(api.notYetKept).toHaveBeenCalledWith('s1');
    expect(api.markKeptDone).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('group', { name: /looks sent/i })).toBeNull());
    expect(screen.queryByTestId('kept-undo')).toBeNull();
  });
});
