import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Find, FIND_BUTTONS } from './Find.js';
import type { FindApi, FindResult } from './findClient.js';

/** [P39-7] Find: nine fixed questions, in order; a result screen per question; "Clients wanting…" in two steps. */
const result = (over: Partial<FindResult> = {}): FindResult => ({
  query: 'missed-promises', count: 2, footnote: 'Promises more than 90 days overdue are kept, but not shown here.',
  items: [
    { clientId: 'c1', clientName: 'Sara Khan', line: 'Send the floor plans', meta: 'Due 1 Oct', overdue: true, owner: 'rep', tags: ['Yours'], receipt: { quote: "I'll send the floor plans", at: '2026-09-20T10:00', noteId: 'n1', clientId: 'c1', sender: 'Rep' } },
    { clientId: 'c2', clientName: 'Omar Ali', line: 'Send ID photos', meta: 'Due 3 Oct', overdue: true, owner: 'client', tags: ['Theirs'], receipt: null },
  ],
  ...over,
});
const api = (r: FindResult | 'paused' = result()): FindApi & { run: ReturnType<typeof vi.fn> } => ({
  run: vi.fn(async () => r),
  wantingOptions: vi.fn(async () => ({ type: ['Villa'], area: ['Mirdif'], budget: [{ value: '2m-5m', label: 'AED 2M to 5M' }] })),
});

describe('[P39-7] Find', () => {
  it('the nine buttons, in order; no free-text box, no Voice button', () => {
    render(<Find api={api()} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    const labels = within(screen.getByTestId('find-buttons')).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Missed promises', 'Due this week', "Who hasn't replied in 2 weeks", 'Clients wanting…', 'Deals at risk', 'Open requirements', 'Active clients', 'Cold clients', 'Full client list']);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /voice/i })).toBeNull();
    expect(FIND_BUTTONS).toHaveLength(9);
  });

  it('a result: "← Find", the question as title, the count first, Yours/Theirs, Overdue, receipts, the footnote', async () => {
    const a = api();
    render(<Find api={a} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Missed promises' }));
    const page = await screen.findByTestId('find-result');
    const header = within(page).getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Missed promises' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Back to Find' })).toBeInTheDocument();
    expect(await within(header).findByText('2 missed promises')).toBeInTheDocument();
    const rows = within(page).getAllByTestId('find-row');
    expect(rows[0]).toHaveTextContent('Yours: Send the floor plans');
    expect(rows[1]).toHaveTextContent('Theirs: Send ID photos');
    expect(within(page).getAllByTestId('due-badge').map((b) => b.textContent)).toEqual(['Overdue', 'Overdue']);
    expect(await within(rows[0]!).findByText("I'll send the floor plans")).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('receipt-empty')).toBeInTheDocument();
    expect(within(page).getByTestId('find-footnote')).toHaveTextContent('90 days');
    expect(a.run).toHaveBeenCalledWith('missed-promises', undefined);
  });

  it('chips built from the result narrow it', async () => {
    render(<Find api={api()} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Missed promises' }));
    const chips = await screen.findByRole('group', { name: 'Narrow the result' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['All2', 'Yours1', 'Theirs1']);
    await userEvent.click(within(chips).getByRole('button', { name: /^Theirs/ }));
    expect(screen.getAllByTestId('find-row')).toHaveLength(1);
    expect(screen.getByTestId('find-row')).toHaveTextContent('Omar Ali');
  });

  it('an empty result says so plainly', async () => {
    render(<Find api={api(result({ count: 0, items: [], footnote: null }))} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Missed promises' }));
    expect(await screen.findByTestId('find-empty')).toHaveTextContent("No missed promises. You're all caught up.");
  });

  it('"Clients wanting…" asks what first (options only from stored values), then shows the result', async () => {
    const a = api(result({ query: 'wanting', count: 1, footnote: null, items: [{ clientId: 'c1', clientName: 'Sara Khan', line: '4BR Villa · Mirdif · ~AED 3M', meta: null, overdue: false, owner: null, tags: ['Villa'], receipt: null }] }));
    render(<Find api={a} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clients wanting…' }));
    const step = await screen.findByTestId('find-wanting');
    for (const h of ['Property type', 'Area', 'Budget']) expect(within(step).getByRole('heading', { name: h })).toBeInTheDocument();
    expect(await within(step).findByRole('button', { name: 'AED 2M to 5M' })).toBeInTheDocument();
    await userEvent.click(within(step).getByRole('button', { name: 'Villa' }));
    expect(a.run).toHaveBeenCalledWith('wanting', { by: 'type', value: 'Villa' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Clients wanting Villa' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Clients wanting…' }));
    expect(await screen.findByTestId('find-wanting')).toBeInTheDocument();
  });

  it('tapping a row opens that client; "Full client list" opens Clients', async () => {
    const onOpenClient = vi.fn();
    const onOpenClients = vi.fn();
    render(<Find api={api()} onOpenClient={onOpenClient} onOpenClients={onOpenClients} />);
    await userEvent.click(screen.getByRole('button', { name: 'Full client list' }));
    expect(onOpenClients).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Missed promises' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open Omar Ali' }));
    expect(onOpenClient).toHaveBeenCalledWith('c2');
  });

  it('negative: a paused account sees why, not an error', async () => {
    render(<Find api={api('paused')} onOpenClient={vi.fn()} onOpenClients={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deals at risk' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/paused/);
  });
});
