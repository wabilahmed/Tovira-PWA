import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChitQueue, type ConfirmQueueApi } from './ConfirmChitQueue.js';
import type { OpenPromise } from '../promises/promisesClient.js';

const p = (id: string, text: string): OpenPromise => ({
  id, clientId: 'c1', text, owner: 'rep', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false,
});

function makeApi(items: OpenPromise[]): ConfirmQueueApi {
  return {
    listConfirmations: vi.fn().mockResolvedValue(items),
    confirm: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
  };
}

// [P39-6 · owner] Each card asks its question ("Did you promise to guess one?") with Yes, track it / No
// (was the guess text with Confirm / Not right); the default heading is "Needs your answer" (was "To confirm").
describe('<ConfirmChitQueue>', () => {
  it('renders a chit for each unconfirmed item', async () => {
    render(<ConfirmChitQueue api={makeApi([p('1', 'Guess one'), p('2', 'Guess two')])} />);
    expect(await screen.findByText('Did you promise to guess one?')).toBeInTheDocument();
    expect(screen.getByText('Did you promise to guess two?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs your answer' })).toBeInTheDocument();
  });

  it('renders nothing when the queue is empty (a clean queue leaves no trace)', async () => {
    const { container } = render(<ConfirmChitQueue api={makeApi([])} />);
    await waitFor(() => expect((makeApi as unknown as { called?: boolean }) && container).toBeTruthy());
    expect(screen.queryByText(/to confirm|needs your answer/i)).toBeNull();
    expect(container.querySelector('.tov-confirm-queue')).toBeNull();
  });

  it('removes a chit once confirmed', async () => {
    const api = makeApi([p('1', 'Only guess')]);
    render(<ConfirmChitQueue api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, track it' }));
    expect(api.confirm).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.queryByText(/only guess/i)).toBeNull());
  });

  it('removes a chit once rejected as not right', async () => {
    const api = makeApi([p('1', 'Only guess')]);
    render(<ConfirmChitQueue api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'No' }));
    expect(api.reject).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.queryByText(/only guess/i)).toBeNull());
  });

  it('accepts a custom heading (Today / Alerts / Monday context)', async () => {
    render(<ConfirmChitQueue api={makeApi([p('1', 'g')])} heading="One guess to confirm" />);
    expect(await screen.findByText(/one guess to confirm/i)).toBeInTheDocument();
  });
});
