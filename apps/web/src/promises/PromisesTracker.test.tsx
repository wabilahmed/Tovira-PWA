import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromisesTracker, type PromisesApi } from './PromisesTracker.js';
import type { OpenPromise } from './promisesClient.js';

const p = (id: string, text: string, extra: Partial<OpenPromise> = {}): OpenPromise => ({
  id, clientId: 'c1', text, owner: 'rep', dueDate: '2026-08-01', dueRaw: null, confidence: 'high', done: false, confirmed: true, ...extra,
});

function makeApi(open: OpenPromise[], pending: OpenPromise[] = []): PromisesApi {
  return {
    listOpen: vi.fn().mockResolvedValue(open),
    listConfirmations: vi.fn().mockResolvedValue(pending),
    markDone: vi.fn().mockResolvedValue(true),
    confirm: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
  };
}

describe('<PromisesTracker>', () => {
  it('lists open promises with their due dates', async () => {
    render(<PromisesTracker api={makeApi([p('p1', 'send quote'), p('p2', 'call back', { dueDate: null, dueRaw: 'next week' })])} />);
    expect(await screen.findByText('send quote')).toBeInTheDocument();
    expect(screen.getByText(/due 2026-08-01/)).toBeInTheDocument();
    expect(screen.getByText(/next week/)).toBeInTheDocument();
    expect(screen.getAllByTestId('open-promise')).toHaveLength(2);
  });

  it('shows an empty state when there are no open promises', async () => {
    render(<PromisesTracker api={makeApi([])} />);
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  // POSITIVE: marking done calls the API and removes the item.
  it('marks a promise done and removes it', async () => {
    const user = userEvent.setup();
    const api = makeApi([p('p1', 'send quote')]);
    render(<PromisesTracker api={api} />);
    await user.click(await screen.findByRole('button', { name: /done/i }));
    await waitFor(() => expect(screen.queryByText('send quote')).toBeNull());
    expect(api.markDone).toHaveBeenCalledWith('p1');
  });

  // NEGATIVE: a failed mark-done keeps the item and shows an error.
  it('keeps the promise and shows an error when mark-done fails', async () => {
    const user = userEvent.setup();
    const api = makeApi([p('p1', 'send quote')]);
    (api.markDone as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    render(<PromisesTracker api={api} />);
    await user.click(await screen.findByRole('button', { name: /done/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('send quote')).toBeInTheDocument();
  });

  // P1-7/P2-3: confirmation queue confirm + reject.
  it('confirms a pending promise and removes it from the queue', async () => {
    const user = userEvent.setup();
    const api = makeApi([], [p('u1', 'maybe send deck', { confirmed: false })]);
    render(<PromisesTracker api={api} />);
    await user.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByText('maybe send deck')).toBeNull());
    expect(api.confirm).toHaveBeenCalledWith('u1');
  });

  it('rejects a pending promise and removes it from the queue', async () => {
    const user = userEvent.setup();
    const api = makeApi([], [p('u1', 'maybe send deck', { confirmed: false })]);
    render(<PromisesTracker api={api} />);
    await user.click(await screen.findByRole('button', { name: /reject/i }));
    await waitFor(() => expect(screen.queryByText('maybe send deck')).toBeNull());
    expect(api.reject).toHaveBeenCalledWith('u1');
  });
});
