import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
    editDueDate: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
    deletePromise: vi.fn().mockResolvedValue(true),
    restore: vi.fn().mockResolvedValue(true),
  };
}

describe('<PromisesTracker>', () => {
  it('lists open promises with their due dates', async () => {
    render(<PromisesTracker api={makeApi([p('p1', 'send quote'), p('p2', 'call back', { dueDate: null, dueRaw: 'next week' })])} />);
    expect(await screen.findByText('send quote')).toBeInTheDocument();
    expect(screen.getByText(/due 1 Aug 2026/)).toBeInTheDocument();
    expect(screen.getByText(/next week/)).toBeInTheDocument();
    expect(screen.getAllByTestId('open-promise')).toHaveLength(2);
  });

  // [P18-4] When a promise has BOTH a resolved due date and the raw phrase it came from, show both —
  // the resolved date for action, the phrase for provenance ("5 Mar 2026 · from 'by Thursday'").
  it('[P18-4] shows the resolved due date AND the raw phrase it was resolved from', async () => {
    render(<PromisesTracker api={makeApi([p('p1', 'ship the samples', { dueDate: '2026-03-05', dueRaw: 'by Thursday' })])} />);
    const row = await screen.findByTestId('open-promise');
    expect(row).toHaveTextContent(/due 5 Mar 2026/);
    expect(row).toHaveTextContent(/from .?by Thursday.?/i); // "from '…'" with either quote glyph
  });

  // [P20-2 / BOOK-09] Delete removes the row and offers Undo; Undo restores it.
  it('[P20-2] deletes a promise, shows "Promise deleted. Undo", and Undo restores it', async () => {
    const deletePromise = vi.fn().mockResolvedValue(true);
    const restore = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), deletePromise, restore }} />);
    await userEvent.click(await screen.findByRole('button', { name: /delete promise: send quote/i }));
    await waitFor(() => expect(deletePromise).toHaveBeenCalledWith('p1'));
    // the row is gone and the undo toast is shown
    expect(screen.queryByTestId('open-promise')).toBeNull();
    const toast = await screen.findByTestId('promise-undo');
    expect(toast).toHaveTextContent(/promise deleted/i);
    // Undo restores the row
    await userEvent.click(within(toast).getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('p1'));
    expect(await screen.findByTestId('open-promise')).toHaveTextContent('send quote');
  });

  it('[PROMISE-STALE] keeps stale promises out of the active list + count, behind a filter', async () => {
    render(<PromisesTracker api={makeApi([p('p1', 'active quote'), p('p2', 'ancient thing', { stale: true, dueDate: '2025-01-01' })])} />);
    // active list shows only the non-stale one
    expect(await screen.findByText('active quote')).toBeInTheDocument();
    expect(screen.getAllByTestId('open-promise')).toHaveLength(1);
    expect(screen.getByText(/1 open/)).toBeInTheDocument(); // count excludes the stale one
    // stale one is hidden until the filter is opened
    expect(screen.queryByText('ancient thing')).toBeNull();
    await userEvent.click(screen.getByText(/Show 1 older promise/));
    expect(screen.getByTestId('stale-promise')).toBeInTheDocument();
    expect(screen.getByText('ancient thing')).toBeInTheDocument();
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

describe('[AUDIT item 2] inline due-date edit', () => {
  it('editing the date input PATCHes the promise (keeps the receipt — no delete/recreate)', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    const input = await screen.findByLabelText('Due date for: send quote');
    // A date input emits one change carrying the full value (how the picker works); drive it that way
    // rather than clear+char-type, which desyncs against a controlled input (the field re-renders).
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    // [P43 · owner] the date saves when the rep confirms it (the picker closes / the field loses focus), not on change
    fireEvent.blur(input);
    await waitFor(() => expect(editDueDate).toHaveBeenCalledWith('p1', '2026-09-15'));
  });

  // [P18-6] Clearing the field must NOT PATCH an empty value — that silently wiped the stored date.
  it('[P18-6] clearing the date field does not send a wipe', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    const input = await screen.findByLabelText('Due date for: send quote');
    await userEvent.clear(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(editDueDate).not.toHaveBeenCalled(); // empty is ignored, not written
  });

  // [P43-8 · owner] One change means one edit record: adjusting the picker never writes; confirming writes once.
  it('[P43-8] adjusting the picker three times, then confirming, writes exactly one edit (the last date)', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    const input = await screen.findByLabelText('Due date for: send quote');
    fireEvent.change(input, { target: { value: '2026-09-13' } });
    fireEvent.change(input, { target: { value: '2026-09-14' } });
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(editDueDate).not.toHaveBeenCalled(); // nothing written while adjusting
    fireEvent.blur(input);
    await waitFor(() => expect(editDueDate).toHaveBeenCalledTimes(1));
    expect(editDueDate).toHaveBeenCalledWith('p1', '2026-09-15');
  });

  it('[P43-8] Enter confirms the chosen date too (once)', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    const input = await screen.findByLabelText('Due date for: send quote');
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(editDueDate).toHaveBeenCalledTimes(1));
  });

  it('[P43-8] NEGATIVE: confirming the same date as stored, or after moving back to it, writes nothing', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    const input = await screen.findByLabelText('Due date for: send quote');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.change(input, { target: { value: '2026-08-01' } }); // back to the stored date
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(editDueDate).not.toHaveBeenCalled();
  });
});
