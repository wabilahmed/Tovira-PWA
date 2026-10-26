import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CostsPanel } from './CostsPanel.js';
import { AdminSignedOutError, type AdminApi, type CostReport } from './adminClient.js';

/**
 * [P44-2 · owner → P45-4] The cost report, moved from /ops/costs into the admin console (admin session, no ops
 * token). Billing period by default, calendar month as a toggle, a CSV download, the AED 67 ceiling and the spending
 * cap highlighted, a totals row per period, and a note that embeddings and infrastructure are left out.
 * [P45 · owner] The token-prompt tests became admin-session tests.
 */
const report = (view: 'period' | 'month'): CostReport => ({
  view, ceilingAed: 67, voiceRecordedSince: Date.parse('2026-10-26T08:00:00Z'),
  rows: [
    { userId: 'u1', email: 'layla@x.io', plan: 'Monthly', key: 'p:1', periodLabel: view === 'period' ? 'from 1 Oct 2026' : 'Oct 2026', group: '2026-10', claudeAed: 70, calls: 12, byClass: { extraction: 60, recall: 10 }, voiceSeconds: 600, voiceAed: 0.07, voiceEstimated: false, totalCostAed: 70.07, revenueAed: 299, marginAed: 228.93, marginPct: 76.57, overCeiling: true, cap: view === 'period' ? { capAed: 45, spentAed: 70, reached: true } : null },
    { userId: 'u2', email: 'omar@x.io', plan: 'Trial', key: 'p:2', periodLabel: 'from 3 Oct 2026', group: '2026-10', claudeAed: 4, calls: 2, byClass: { extraction: 4 }, voiceSeconds: null, voiceAed: null, voiceEstimated: false, totalCostAed: 4, revenueAed: 0, marginAed: -4, marginPct: null, overCeiling: false, cap: view === 'period' ? { capAed: 15, spentAed: 4, reached: false } : null },
  ],
  totals: [{ group: '2026-10', label: view === 'period' ? 'Periods starting Oct 2026' : 'Oct 2026', costAed: 74.07, revenueAed: 299, marginAed: 224.93, marginPct: 75.23 }],
});
type CostsApi = Pick<AdminApi, 'costs' | 'downloadCsv'>;
function api(over: Partial<CostsApi> = {}): CostsApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    costs: vi.fn(async (view: 'period' | 'month') => { calls.push(`get:${view}`); return report(view); }),
    downloadCsv: vi.fn(async (path: string) => { calls.push(`csv:${path}`); }),
    ...over,
  };
}
async function open(a: CostsApi): Promise<void> {
  render(<CostsPanel api={a} onSignedOut={vi.fn()} />);
}

describe('[P44-2] /ops/costs', () => {
  it('[P45 · owner] never asks for the ops token', async () => {
    await open(api());
    await screen.findByTestId('cost-row-u1-p:1');
    expect(screen.queryByLabelText(/ops token/i)).toBeNull();
  });

  it('billing period by default: one row per user per period with cost, revenue and margin', async () => {
    const a = api();
    await open(a);
    const row = await screen.findByTestId('cost-row-u1-p:1');
    expect(a.calls).toEqual(['get:period']);
    for (const t of ['layla@x.io', 'Monthly', 'from 1 Oct 2026', '70.00', '0.07', '70.07', '12', 'extraction 60.00', 'recall 10.00', '299.00', '228.93', '76.6%']) expect(row).toHaveTextContent(t);
  });

  it('highlights past the AED 67 ceiling and at or past the cap; not the others', async () => {
    await open(api());
    const hot = await screen.findByTestId('cost-row-u1-p:1');
    expect(within(hot).getByText('Over AED 67')).toBeInTheDocument();
    expect(within(hot).getByText('At cap (AED 45)')).toBeInTheDocument();
    const calm = screen.getByTestId('cost-row-u2-p:2');
    expect(within(calm).queryByText(/Over AED 67|At cap/)).toBeNull();
    expect(calm).toHaveTextContent('Not recorded'); // voice before recording began
  });

  it('a totals row per period: cost, revenue and margin across users', async () => {
    await open(api());
    const total = await screen.findByTestId('cost-total-2026-10');
    for (const t of ['Periods starting Oct 2026', '74.07', '299.00', '224.93', '75.2%']) expect(total).toHaveTextContent(t);
  });

  it('the toggle switches to calendar month (and back); the CSV downloads the view shown', async () => {
    const a = api();
    await open(a);
    await screen.findByTestId('cost-row-u1-p:1');
    await userEvent.click(screen.getByRole('button', { name: 'Calendar month' }));
    await waitFor(() => expect(a.calls).toContain('get:month'));
    expect(await screen.findByText('Oct 2026', { selector: '[data-testid="cost-row-u1-p:1"] *' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(a.calls).toContain('csv:/costs?view=month&format=csv');
  });

  it('says what is left out, and from when voice cost is recorded', async () => {
    await open(api());
    await screen.findByTestId('cost-row-u1-p:1');
    expect(screen.getByTestId('costs-note')).toHaveTextContent('Embeddings and infrastructure (AWS, database, email) are not included.');
    expect(screen.getByTestId('costs-note')).toHaveTextContent('Voice-note cost is estimated from recorded audio seconds at the Groq rate, recorded from 26 Oct 2026.');
  });

  it('[P45 · owner] NEGATIVE: a signed-out admin session goes back to sign-in', async () => {
    const onSignedOut = vi.fn();
    render(<CostsPanel api={api({ costs: vi.fn(async () => { throw new AdminSignedOutError(); }) })} onSignedOut={onSignedOut} />);
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});
