import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ledger, type LedgerApi } from './Ledger.js';
import type { LedgerSummary } from './ledgerClient.js';

function makeApi(summary: LedgerSummary | null, over: Partial<LedgerApi> = {}): LedgerApi {
  return { summary: vi.fn().mockResolvedValue(summary), setDealValue: vi.fn().mockResolvedValue(true), ...over };
}

const withValue: LedgerSummary = {
  totalTouched: 3,
  byType: { promise_kept: 2, thread_reopened: 1, brief_before_meeting: 0, inventory_suggested_bought: 0 },
  aed: 500000,
  items: [],
};

const clients = [{ id: 'c1', name: 'Acme' }];

describe('<Ledger>', () => {
  it('summarises touched opportunities with counts by type', async () => {
    render(<Ledger api={makeApi(withValue)} clients={clients} />);
    expect(await screen.findByTestId('headline')).toHaveTextContent(/touched 3 opportunities/i);
    expect(screen.getByTestId('type-promise_kept')).toHaveTextContent(/2 × promise kept/i);
    expect(screen.queryByTestId('type-brief_before_meeting')).toBeNull(); // zero-count hidden
  });

  it('shows the AED figure only when present', async () => {
    render(<Ledger api={makeApi(withValue)} clients={clients} />);
    expect(await screen.findByTestId('headline')).toHaveTextContent(/AED 500,000/);
  });

  // HONESTY: no AED figure when the rep hasn't entered deal values.
  it('shows no AED figure when aed is null', async () => {
    render(<Ledger api={makeApi({ ...withValue, aed: null })} clients={clients} />);
    const headline = await screen.findByTestId('headline');
    expect(headline).not.toHaveTextContent(/AED/);
  });

  // HONESTY: the copy never uses "closed"/"won"/causal claims — asserted over output.
  it('never uses "closed" or "won" in its copy', async () => {
    const { container } = render(<Ledger api={makeApi(withValue)} clients={clients} />);
    await screen.findByTestId('headline');
    expect(container.textContent!.toLowerCase()).not.toMatch(/closed|won\b/);
    expect(container.textContent!.toLowerCase()).toContain('touched');
  });

  it('shows an empty state when nothing has been touched', async () => {
    render(<Ledger api={makeApi({ totalTouched: 0, byType: { promise_kept: 0, thread_reopened: 0, brief_before_meeting: 0, inventory_suggested_bought: 0 }, aed: null, items: [] })} clients={clients} />);
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument();
  });

  // POSITIVE: entering a deal value calls the API and reloads.
  it('saves a deal value', async () => {
    const user = userEvent.setup();
    const api = makeApi(withValue);
    render(<Ledger api={api} clients={clients} />);
    await screen.findByTestId('headline');
    await user.type(screen.getByLabelText(/deal value \(aed\)/i), '750000');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.setDealValue).toHaveBeenCalledWith('c1', 750000));
  });

  it('shows an error when it cannot load', async () => {
    render(<Ledger api={makeApi(null)} clients={clients} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
