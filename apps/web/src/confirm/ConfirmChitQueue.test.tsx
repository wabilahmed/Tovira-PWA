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

describe('<ConfirmChitQueue>', () => {
  it('renders a chit for each unconfirmed item', async () => {
    render(<ConfirmChitQueue api={makeApi([p('1', 'Guess one'), p('2', 'Guess two')])} />);
    expect(await screen.findByText('Guess one')).toBeInTheDocument();
    expect(screen.getByText('Guess two')).toBeInTheDocument();
    expect(screen.getByText(/to confirm/i)).toBeInTheDocument();
  });

  it('renders nothing when the queue is empty (a clean queue leaves no trace)', async () => {
    const { container } = render(<ConfirmChitQueue api={makeApi([])} />);
    await waitFor(() => expect((makeApi as unknown as { called?: boolean }) && container).toBeTruthy());
    expect(screen.queryByText(/to confirm/i)).toBeNull();
    expect(container.querySelector('.tov-confirm-queue')).toBeNull();
  });

  it('removes a chit once confirmed', async () => {
    const api = makeApi([p('1', 'Only guess')]);
    render(<ConfirmChitQueue api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }));
    expect(api.confirm).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.queryByText('Only guess')).toBeNull());
  });

  it('removes a chit once rejected as not right', async () => {
    const api = makeApi([p('1', 'Only guess')]);
    render(<ConfirmChitQueue api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /not right/i }));
    expect(api.reject).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.queryByText('Only guess')).toBeNull());
  });

  it('accepts a custom heading (Today / Alerts / Monday context)', async () => {
    render(<ConfirmChitQueue api={makeApi([p('1', 'g')])} heading="One guess to confirm" />);
    expect(await screen.findByText(/one guess to confirm/i)).toBeInTheDocument();
  });
});
