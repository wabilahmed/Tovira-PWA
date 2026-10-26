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

// [P46-6b · owner] The actions moved off the row into a sheet opened by tapping the row (nothing destructive on the row),
// and the status is a badge in normal case. These tests open the row first, then check the same behaviour.
async function openRow(text: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: `Open: ${text}` }));
}
async function openDate(text: string): Promise<void> {
  await openRow(text);
  await userEvent.click(await screen.findByRole('button', { name: 'Change date' }));
}

describe('<PromisesTracker>', () => {
  it('lists open promises with their due dates', async () => {
    // [P46-6b · owner] the date is a badge: "Due Sat 1 Aug"; a phrase without a date reads in quotes
    render(<PromisesTracker api={makeApi([p('p1', 'send quote'), p('p2', 'call back', { dueDate: null, dueRaw: 'next week' })])} now={Date.parse('2026-07-20T12:00:00')} />);
    expect(await screen.findByText('send quote')).toBeInTheDocument();
    expect(screen.getByText('Due Sat 1 Aug')).toBeInTheDocument();
    expect(screen.getByText(/next week/)).toBeInTheDocument();
    expect(screen.getAllByTestId('open-promise')).toHaveLength(2);
  });

  // [P18-4] When a promise has BOTH a resolved due date and the raw phrase it came from, show both —
  // the resolved date for action, the phrase for provenance ("5 Mar 2026 · from 'by Thursday'").
  it('[P18-4] shows the resolved due date AND the raw phrase it was resolved from', async () => {
    // [P46-6b · owner] the row shows the date badge; the phrase it came from is in the row's sheet
    render(<PromisesTracker api={makeApi([p('p1', 'ship the samples', { dueDate: '2026-03-05', dueRaw: 'by Thursday' })])} now={Date.parse('2026-03-01T12:00:00')} />);
    const row = await screen.findByTestId('open-promise');
    expect(row).toHaveTextContent(/Due Thu 5 Mar/);
    await openRow('ship the samples');
    expect(screen.getByRole('dialog')).toHaveTextContent(/from .?by Thursday.?/i); // "from '…'" with either quote glyph
  });

  // [P20-2 / BOOK-09] Delete removes the row and offers Undo; Undo restores it.
  it('[P20-2] deletes a promise, shows "Promise deleted. Undo", and Undo restores it', async () => {
    const deletePromise = vi.fn().mockResolvedValue(true);
    const restore = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), deletePromise, restore }} />);
    await openRow('send quote'); // [P46-6b · owner] Delete is in the sheet
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
    // [P46-6b · owner] the counts are filter chips; "Older than 90 days (1)" holds the stale one
    expect(within(screen.getByRole('group', { name: 'Filter promises' })).getByRole('button', { name: /^Open/ })).toHaveTextContent('1'); // count excludes the stale one
    // stale one is hidden until the filter is opened
    expect(screen.queryByText('ancient thing')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Older than 90 days/ }));
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
    await openRow('send quote'); // [P46-6b · owner] "Mark done" is in the sheet
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(screen.queryByText('send quote')).toBeNull());
    expect(api.markDone).toHaveBeenCalledWith('p1');
  });

  // NEGATIVE: a failed mark-done keeps the item and shows an error.
  it('keeps the promise and shows an error when mark-done fails', async () => {
    const user = userEvent.setup();
    const api = makeApi([p('p1', 'send quote')]);
    (api.markDone as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    render(<PromisesTracker api={api} />);
    await openRow('send quote'); // [P46-6b · owner]
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('send quote')).toBeInTheDocument();
  });

  // P1-7/P2-3: confirmation queue confirm + reject.
  it('confirms a pending promise and removes it from the queue', async () => {
    const user = userEvent.setup();
    const api = makeApi([], [p('u1', 'maybe send deck', { confirmed: false })]);
    render(<PromisesTracker api={api} />);
    // [P46-6b · owner] under the "To confirm" chip; Confirm is in the sheet
    await user.click(await screen.findByRole('button', { name: /^To confirm/ }));
    await openRow('maybe send deck');
    await user.click(await screen.findByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(screen.queryByText('maybe send deck')).toBeNull());
    expect(api.confirm).toHaveBeenCalledWith('u1');
  });

  it('rejects a pending promise and removes it from the queue', async () => {
    const user = userEvent.setup();
    const api = makeApi([], [p('u1', 'maybe send deck', { confirmed: false })]);
    render(<PromisesTracker api={api} />);
    await user.click(await screen.findByRole('button', { name: /^To confirm/ })); // [P46-6b · owner]
    await openRow('maybe send deck');
    await user.click(await screen.findByRole('button', { name: /reject/i }));
    await waitFor(() => expect(screen.queryByText('maybe send deck')).toBeNull());
    expect(api.reject).toHaveBeenCalledWith('u1');
  });
});

// [P46-6b · owner] the date field opens from "Change date" in the row's sheet; it still saves once, on confirm
describe('[AUDIT item 2] inline due-date edit', () => {
  it('editing the date input PATCHes the promise (keeps the receipt — no delete/recreate)', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    await openDate('send quote');
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
    await openDate('send quote');
    const input = await screen.findByLabelText('Due date for: send quote');
    await userEvent.clear(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(editDueDate).not.toHaveBeenCalled(); // empty is ignored, not written
  });

  // [P43-8 · owner] One change means one edit record: adjusting the picker never writes; confirming writes once.
  it('[P43-8] adjusting the picker three times, then confirming, writes exactly one edit (the last date)', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    await openDate('send quote');
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
    await openDate('send quote');
    const input = await screen.findByLabelText('Due date for: send quote');
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(editDueDate).toHaveBeenCalledTimes(1));
  });

  it('[P43-8] NEGATIVE: confirming the same date as stored, or after moving back to it, writes nothing', async () => {
    const editDueDate = vi.fn().mockResolvedValue(true);
    render(<PromisesTracker api={{ ...makeApi([p('p1', 'send quote')]), editDueDate }} />);
    await openDate('send quote');
    const input = await screen.findByLabelText('Due date for: send quote');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.change(input, { target: { value: '2026-08-01' } }); // back to the stored date
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(editDueDate).not.toHaveBeenCalled();
  });
});


// [P46-6b] Owner (phone review): the page scrolled sideways, the text was squeezed, every row had a date field, Done and
// Delete, no row said whose promise it was, the status was mono uppercase, and a past date said "DUE" not Overdue.
describe('[P46-6b] the Promises screen', () => {
  const NOW = Date.parse('2026-10-26T12:00:00');
  const rows = [
    p('p1', 'Pay the deposit, contingent on mortgage approval', { clientId: 'c2', clientName: 'Mohammed Al Kaabi', owner: 'client', dueDate: '2026-10-20', dueRaw: 'Sunday morning', receipt: { quote: 'I will pay the deposit once the bank approves', source: 'message', at: '2026-10-18T09:00', label: '' } }),
    p('p2', 'Send the revised proposal', { clientId: 'c1', clientName: 'Sara Khan', dueDate: '2026-10-29', dueRaw: 'by Thursday' }),
    p('p3', 'Introduce him to the finance team', { clientId: 'c4', clientName: 'Omar Ali', dueDate: null, dueRaw: 'after the holidays', dateStatus: 'to_confirm' }),
    p('p4', 'Share the brochure', { clientId: 'c3', clientName: 'Layla Hassan', dueDate: null, dueRaw: null }),
    p('p5', 'Call back about the renewal', { clientName: 'Sara Khan', dueDate: '2026-06-01', stale: true }),
  ];
  const api = (over: Partial<PromisesApi> = {}): PromisesApi => ({
    ...makeApi(rows, [p('q1', 'Send the ID photos', { clientName: 'Mohammed Al Kaabi', confirmed: false, owner: 'client', dueDate: null })]),
    tracker: vi.fn().mockResolvedValue({ promises: rows, done: [p('d1', 'Sent the floor plans', { clientName: 'Sara Khan', done: true })], staleThresholdDays: 90 }),
    answerDate: vi.fn().mockResolvedValue(true),
    ...over,
  });

  it('a header with back, and filter chips: Open · Overdue · To confirm · Done · Older than 90 days (1)', async () => {
    render(<PromisesTracker api={api()} now={NOW} back={{ label: 'More', onBack: vi.fn() }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Promises' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to More' })).toBeInTheDocument();
    const chips = within(screen.getByRole('group', { name: 'Filter promises' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['Open4', 'Overdue1', 'To confirm2', 'Done1', 'Older than 90 days (1)']);
  });

  it('each row: the client name, the text, whose promise, one badge, the receipt', async () => {
    render(<PromisesTracker api={api()} now={NOW} />);
    const row = (await screen.findByText('Pay the deposit, contingent on mortgage approval')).closest('li')!;
    expect(within(row).getByTestId('row-name')).toHaveTextContent('Mohammed Al Kaabi');
    expect(row).toHaveTextContent('Mohammed Al Kaabi promised');
    expect(within(row).getByText('Overdue')).toHaveClass('ui-badge--danger');
    const mine = (await screen.findByText('Send the revised proposal')).closest('li')!;
    expect(mine).toHaveTextContent('You promised');
    expect(within(mine).getByText('Due Thu 29 Oct')).toHaveClass('ui-badge');
    const tbc = screen.getByText('Introduce him to the finance team').closest('li')!;
    expect(tbc).toHaveTextContent('Date to confirm “after the holidays”');
    expect(screen.getByText('Share the brochure').closest('li')!).toHaveTextContent('No date');
    expect(row.querySelector('[data-testid="row-receipt"]')).not.toBeNull();
  });

  it('NEGATIVE: no date field, Done or Delete on a row; no mono uppercase status; never "DUE" for a past date', async () => {
    const { container } = render(<PromisesTracker api={api()} now={NOW} />);
    const row = (await screen.findByText('Pay the deposit, contingent on mortgage approval')).closest('li')!;
    expect(row.querySelector('input')).toBeNull();
    expect(within(row).queryByRole('button', { name: /done|delete/i })).toBeNull();
    expect(container.querySelector('.tov-stamp')).toBeNull();
    expect(container.textContent).not.toMatch(/\bDUE\b|NO DATE|DATE TO CONFIRM/);
  });

  it('tapping a row opens its sheet: Mark done, Change date, Answer "when is it due?" (to confirm only), Delete last in danger style', async () => {
    render(<PromisesTracker api={api()} now={NOW} />);
    await openRow('Introduce him to the finance team');
    const sheet = screen.getByRole('dialog');
    const labels = within(sheet).getAllByRole('button').map((b) => b.textContent).filter((t) => t && t !== '×');
    expect(labels).toEqual(['Mark done', 'Change date', 'Answer “when is it due?”', 'Delete']);
    expect(within(sheet).getByRole('button', { name: /delete promise/i })).toHaveClass('ui-btn--danger');
  });

  it('NEGATIVE: a promise with a date has no "when is it due?" answer', async () => {
    render(<PromisesTracker api={api()} now={NOW} />);
    await openRow('Send the revised proposal');
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /when is it due/i })).toBeNull();
  });

  it('answering "when is it due?" sends the answer', async () => {
    const a = api();
    render(<PromisesTracker api={a} now={NOW} />);
    await openRow('Introduce him to the finance team');
    await userEvent.click(screen.getByRole('button', { name: 'Answer “when is it due?”' }));
    await userEvent.click(screen.getByRole('button', { name: 'No due date' }));
    await waitFor(() => expect(a.answerDate).toHaveBeenCalledWith('p3', { dateStatus: 'no_due_date' }));
  });

  it('the chips filter the list', async () => {
    render(<PromisesTracker api={api()} now={NOW} />);
    await screen.findByText('Send the revised proposal');
    await userEvent.click(screen.getByRole('button', { name: /^Overdue/ }));
    expect(screen.getAllByTestId('open-promise').map((r) => within(r).getByTestId('row-wants').textContent)).toEqual(['Pay the deposit, contingent on mortgage approval']);
    await userEvent.click(screen.getByRole('button', { name: /^Done/ }));
    expect(screen.getByText('Sent the floor plans')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^To confirm/ }));
    expect(screen.getByText('Send the ID photos')).toBeInTheDocument();
    expect(screen.getByText('Introduce him to the finance team')).toBeInTheDocument();
  });
});
