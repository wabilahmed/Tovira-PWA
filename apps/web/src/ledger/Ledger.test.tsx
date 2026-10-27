import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ledger, ledgerTotals, type LedgerApi } from './Ledger.js';
import type { LedgerEntry, LedgerSummary, WinBack } from './ledgerClient.js';

vi.mock('../receipts/ReceiptThread.js', () => ({ ReceiptThread: ({ refInfo }: { refInfo: { quote: string } }) => <blockquote data-testid="receipt">{refInfo.quote}</blockquote> }));

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 86_400_000;
const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  clientId: 'c1', clientName: 'Sara Khan', itemTitle: 'Premium plan', suggestedAt: NOW - 14 * DAY,
  receipt: { quote: 'we need cover for the whole family', statedOn: '2026-10-10', noteId: 'n1' },
  outcome: 'bought', boughtAt: NOW - 6 * DAY, wonAt: null, outcomeAt: NOW - 6 * DAY, dealValueAed: null, ...o,
});
const view = (entries: LedgerEntry[]): LedgerSummary => ({
  totalTouched: entries.length, byType: { promise_kept: 0, thread_reopened: 0, brief_before_meeting: 0, inventory_suggested_bought: entries.length, won_after_suggestion: 0 }, aed: null, items: [], entries, winBacks: [],
});
function makeApi(summary: LedgerSummary | null, over: Partial<LedgerApi> = {}): LedgerApi {
  return { summary: vi.fn().mockResolvedValue(summary), setEntryDealValue: vi.fn().mockResolvedValue(true), ...over };
}
const two = [entry({ id: 'e1', dealValueAed: 12500 }), entry({ id: 'e2', clientName: 'Omar Ali', itemTitle: 'Q3 proposal', outcomeAt: NOW - 70 * DAY, dealValueAed: 4000 })];

// [P46-5 · owner] The Ledger was redesigned: "the record of what Tovira helped you win". These keep the old checks
// (a summary, AED only from values the rep entered, an honest empty state, saving a value, the load error, nothing
// overflowing) on the new design: a summary per period, one card per deal, the value entered on its card.
describe('<Ledger>', () => {
  it('summarises the deals Tovira helped with', async () => {
    render(<Ledger api={makeApi(view(two))} now={NOW} />);
    expect(await screen.findByTestId('deals-count')).toHaveTextContent('2');
  });

  it('shows the AED figure only when present', async () => {
    render(<Ledger api={makeApi(view(two))} now={NOW} />);
    expect(await screen.findByTestId('deals-value')).toHaveTextContent('AED 16,500');
  });

  // HONESTY: no AED figure when the rep hasn't entered deal values.
  it('shows no AED figure when aed is null', async () => {
    render(<Ledger api={makeApi(view([entry({ id: 'e1' })]))} now={NOW} />);
    const value = await screen.findByTestId('deals-value');
    expect(value).not.toHaveTextContent(/AED \d/);
    expect(value).toHaveTextContent('Add deal values to see the total');
  });

  // HONESTY: no "closed" and no causal claim on a card ("Tovira closed it"); the owner's header says "helped you win".
  it('never uses "closed" or "won" in its copy', async () => {
    const { container } = render(<Ledger api={makeApi(view(two))} now={NOW} />);
    await screen.findByTestId('deals-count');
    // [P47 · owner] "won" is now the owner's own word ("Clients won back", "You marked them Won"); still never
    // "closed", and never Tovira claiming the win ("Tovira won …")
    expect(container.textContent!.toLowerCase()).not.toMatch(/closed|tovira won\b/);
  });

  it('shows an empty state when nothing has been touched', async () => {
    render(<Ledger api={makeApi(view([]))} now={NOW} />);
    expect(await screen.findByText(/When Tovira’s suggestion leads to a sale, it shows up here/)).toBeInTheDocument();
  });

  // POSITIVE: entering a deal value calls the API and reloads.
  it('saves a deal value', async () => {
    const api = makeApi(view([entry({ id: 'e1' })]));
    render(<Ledger api={api} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add deal value' }));
    await userEvent.type(screen.getByLabelText('Deal value (AED)'), '750000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setEntryDealValue).toHaveBeenCalledWith('e1', 750000));
  });

  it('shows an error when it cannot load', async () => {
    render(<Ledger api={makeApi(null)} now={NOW} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // [P18-9] At 390px a long client name must not overflow. The client picker is gone (owner: the value is entered on the
  // card); a long name sits in the card title, which wraps.
  it('[P18-9] constrains the client picker so a long name cannot overflow at 390px', async () => {
    const { container } = render(<Ledger api={makeApi(view([entry({ id: 'e1', clientName: 'A'.repeat(90) })]))} now={NOW} />);
    await screen.findByTestId('deals-count');
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByText('A'.repeat(90)).closest('.ui-row__title, .ui-strong')).not.toBeNull();
  });
});

// [P46-5] Owner: the header, the summary per period, one card per deal (what Tovira did with its receipt, what happened,
// the value entered on the card), and the empty state with a link to Inventory.
describe('[P46-5] the Ledger', () => {
  it('the header: "The Ledger", "← More", "What Tovira helped you win"', async () => {
    render(<Ledger api={makeApi(view(two))} now={NOW} back={{ label: 'More', onBack: vi.fn() }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'The Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to More' })).toBeInTheDocument();
    expect(screen.getByText('What Tovira helped you win')).toBeInTheDocument();
  });

  it('ledgerTotals: the count and the value of the deals in the period; values the rep never entered add nothing', () => {
    const es = [entry({ id: 'a', dealValueAed: 1000, outcomeAt: NOW - 2 * DAY }), entry({ id: 'b', dealValueAed: null, outcomeAt: NOW - 3 * DAY }), entry({ id: 'c', dealValueAed: 500, outcomeAt: NOW - 60 * DAY }), entry({ id: 'd', dealValueAed: 0, outcomeAt: NOW - 400 * DAY })];
    // [P47-2 · owner] a fourth figure, wonBack (no win-backs here → 0)
    expect(ledgerTotals(es, 'month', NOW)).toEqual({ count: 2, valueAed: 1000, withValue: 1, wonBack: 0 });
    expect(ledgerTotals(es, '3months', NOW)).toEqual({ count: 3, valueAed: 1500, withValue: 2, wonBack: 0 });
    expect(ledgerTotals(es, 'all', NOW)).toEqual({ count: 4, valueAed: 1500, withValue: 3, wonBack: 0 });
    expect(ledgerTotals([entry({ id: 'x' })], 'all', NOW)).toEqual({ count: 1, valueAed: null, withValue: 0, wonBack: 0 });
  });

  it('the period picker: This month / Last 3 months / All time changes the summary and the list', async () => {
    render(<Ledger api={makeApi(view(two))} now={NOW} />);
    expect(await screen.findByTestId('deals-count')).toHaveTextContent('2'); // All time is the default
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByTestId('deals-count')).toHaveTextContent('1');
    expect(screen.getByTestId('deals-value')).toHaveTextContent('AED 12,500');
    expect(screen.queryByText('Omar Ali')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(screen.getByTestId('deals-count')).toHaveTextContent('2');
  });

  it('a card: the client, what Tovira did with its receipt, what happened, the value', async () => {
    render(<Ledger api={makeApi(view([entry({ id: 'e1', dealValueAed: 12500 })]))} now={NOW} />);
    const card = (await screen.findByText('Sara Khan')).closest('li')!;
    expect(card.textContent).toContain('Suggested Premium plan on 12 Oct');
    expect(within(card).getByTestId('receipt')).toHaveTextContent('we need cover for the whole family');
    expect(card.textContent).toContain('Marked bought on 20 Oct');
    expect(card.textContent).toContain('AED 12,500');
  });

  it('NEGATIVE: no "Tovira touched N opportunities", no "N × …" counts, no separate deal-value form', async () => {
    const { container } = render(<Ledger api={makeApi(view(two))} now={NOW} />);
    await screen.findByTestId('deals-count');
    expect(container.textContent).not.toMatch(/touched|opportunit|×/);
    expect(screen.queryByLabelText(/deal value client/i)).toBeNull();
  });

  it('a value can be changed and cleared on its card', async () => {
    const api = makeApi(view([entry({ id: 'e1', dealValueAed: 12500 })]));
    render(<Ledger api={api} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change deal value' }));
    const input = screen.getByLabelText('Deal value (AED)');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setEntryDealValue).toHaveBeenCalledWith('e1', null));
  });

  it('NEGATIVE: a value that is not a number is not sent', async () => {
    const api = makeApi(view([entry({ id: 'e1' })]));
    render(<Ledger api={api} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add deal value' }));
    await userEvent.type(screen.getByLabelText('Deal value (AED)'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.setEntryDealValue).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/number/i);
  });

  it('the empty state links to Inventory', async () => {
    const onOpenInventory = vi.fn();
    render(<Ledger api={makeApi(view([]))} now={NOW} onOpenInventory={onOpenInventory} />);
    expect(await screen.findByText('When Tovira’s suggestion leads to a sale, it shows up here. Add what you sell in Inventory to start.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Inventory' }));
    expect(onOpenInventory).toHaveBeenCalled();
  });
});

// [P47-1] Owner: "Won after a suggestion". The card says "Tovira suggested <item> on <date>" with its receipt and
// "You marked them Won on <date>"; a suggestion marked bought and then Won is one card with both facts.
describe('[P47-1] Won after a suggestion on the Ledger', () => {
  it('a Won card: Tovira suggested …, its receipt, You marked them Won on …, the deal value', async () => {
    render(<Ledger api={makeApi(view([entry({ id: 'w1', outcome: 'won', boughtAt: null, wonAt: NOW - 4 * DAY, outcomeAt: NOW - 4 * DAY, dealValueAed: 9000 })]))} now={NOW} />);
    const card = (await screen.findByText('Sara Khan')).closest('li')!;
    expect(card.textContent).toContain('Tovira suggested Premium plan on 12 Oct');
    expect(within(card).getByTestId('receipt')).toHaveTextContent('we need cover for the whole family');
    expect(card.textContent).toContain('You marked them Won on 22 Oct');
    expect(card.textContent).not.toContain('Marked bought');
    expect(card.textContent).toContain('AED 9,000');
  });

  it('bought and Won: one card with both facts', async () => {
    render(<Ledger api={makeApi(view([entry({ id: 'b1', outcome: 'bought_won', boughtAt: NOW - 6 * DAY, wonAt: NOW - 4 * DAY, outcomeAt: NOW - 4 * DAY })]))} now={NOW} />);
    expect(await screen.findAllByTestId('ledger-entry')).toHaveLength(1);
    const card = screen.getByTestId('ledger-entry');
    expect(card.textContent).toContain('Suggested Premium plan on 12 Oct');
    expect(card.textContent).toContain('Marked bought on 20 Oct · Won on 22 Oct');
  });

  it('a Won counts toward "Deals Tovira helped with" and its value toward the total', async () => {
    render(<Ledger api={makeApi(view([entry({ id: 'b1', dealValueAed: 1000 }), entry({ id: 'w1', outcome: 'won', boughtAt: null, wonAt: NOW - 2 * DAY, outcomeAt: NOW - 2 * DAY, dealValueAed: 500 })]))} now={NOW} />);
    expect(await screen.findByTestId('deals-count')).toHaveTextContent('2');
    expect(screen.getByTestId('deals-value')).toHaveTextContent('AED 1,500');
  });
});

// [P47-2] Owner: "Clients Tovira helped you win back", a separate section under the deals: the client, "Tovira flagged
// them as going quiet on <date> (<N> days silent)", "They wrote back on <date>" with their message. No AED. A third
// summary figure, "Clients won back", that never adds to the AED total. The period picker filters everything.
describe('[P47-2] Clients Tovira helped you win back', () => {
  const wb = (o: Partial<WinBack> & { id: string }): WinBack => ({ clientId: 'c9', clientName: 'Layla Hassan', flaggedAt: NOW - 9 * DAY, silentDays: 42, wroteBackAt: NOW - 7 * DAY, receipt: { quote: 'Back from travel, can we talk?', at: '2026-10-19T10:00', noteId: 'n9' }, ...o });
  const both = (entries: LedgerEntry[], winBacks: WinBack[]): LedgerSummary => ({ ...view(entries), winBacks });

  it('a separate section under the deals; each card: the client, the flag, the reply with its message; no AED', async () => {
    render(<Ledger api={makeApi(both([entry({ id: 'e1' })], [wb({ id: 'w1' })]))} now={NOW} />);
    const section = await screen.findByRole('region', { name: 'Clients Tovira helped you win back' });
    expect(within(section).getByRole('heading', { name: 'Clients Tovira helped you win back' })).toBeInTheDocument();
    const card = within(section).getByText('Layla Hassan').closest('li')!;
    expect(card.textContent).toContain('Tovira flagged them as going quiet on 17 Oct (42 days silent)');
    expect(card.textContent).toContain('They wrote back on 19 Oct');
    expect(within(card).getByTestId('receipt')).toHaveTextContent('Back from travel, can we talk?');
    expect(card.textContent).not.toMatch(/AED|deal value/i);
    const deals = screen.getAllByTestId('ledger-entry')[0]!;
    expect(deals.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // under the deals
  });

  it('the summary: deals, their value, and "Clients won back", which never adds to the AED total', async () => {
    render(<Ledger api={makeApi(both([entry({ id: 'e1', dealValueAed: 1000 })], [wb({ id: 'w1' }), wb({ id: 'w2', clientName: 'Omar', wroteBackAt: NOW - 2 * DAY })]))} now={NOW} />);
    expect(await screen.findByTestId('deals-count')).toHaveTextContent('1');
    expect(screen.getByTestId('deals-value')).toHaveTextContent('AED 1,000');
    expect(screen.getByTestId('won-back-count')).toHaveTextContent('2');
    expect(screen.getByText('Clients won back')).toBeInTheDocument();
  });

  it('ledgerTotals counts win-backs in the period', () => {
    const t = ledgerTotals([entry({ id: 'a', outcomeAt: NOW - 2 * DAY })], 'month', NOW, [wb({ id: 'w1', wroteBackAt: NOW - 2 * DAY }), wb({ id: 'w2', wroteBackAt: NOW - 70 * DAY })]);
    expect(t).toEqual({ count: 1, valueAed: null, withValue: 0, wonBack: 1 });
  });

  it('the period picker filters both lists and all three figures', async () => {
    render(<Ledger api={makeApi(both([entry({ id: 'e1', outcomeAt: NOW - 70 * DAY })], [wb({ id: 'w1', wroteBackAt: NOW - 70 * DAY }), wb({ id: 'w2', clientName: 'Omar', wroteBackAt: NOW - 2 * DAY })]))} now={NOW} />);
    await screen.findByTestId('deals-count');
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByTestId('deals-count')).toHaveTextContent('0');
    expect(screen.getByTestId('won-back-count')).toHaveTextContent('1');
    expect(screen.queryByText('Layla Hassan')).toBeNull();
    expect(screen.getByText('Omar')).toBeInTheDocument();
  });

  it("the win-back section's empty state", async () => {
    render(<Ledger api={makeApi(both([entry({ id: 'e1' })], []))} now={NOW} />);
    const section = await screen.findByRole('region', { name: 'Clients Tovira helped you win back' });
    expect(section.textContent).toContain('When a client Tovira flagged as going quiet writes back within a week, it shows up here.');
  });

  it('only win-backs (no deals yet): the Ledger is not empty, it shows them', async () => {
    render(<Ledger api={makeApi(both([], [wb({ id: 'w1' })]))} now={NOW} />);
    expect(await screen.findByText('Layla Hassan')).toBeInTheDocument();
    expect(screen.getByTestId('won-back-count')).toHaveTextContent('1');
  });
});
