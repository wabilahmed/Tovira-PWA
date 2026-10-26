import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CostsAdmin } from './CostsAdmin.js';
import { OpsUnauthorizedError } from './opsAccessClient.js';
import type { OpsCostsApi, CostReport } from './opsCostsClient.js';

/**
 * [P44-2 · owner] /ops/costs: the ops cost report (ops token, like /ops/access). Billing period by default, calendar
 * month as a toggle, a CSV download, the AED 67 ceiling and the spending cap highlighted, a totals row per period,
 * and a note that embeddings and infrastructure are left out.
 */
const report = (view: 'period' | 'month'): CostReport => ({
  view, ceilingAed: 67, voiceRecordedSince: Date.parse('2026-10-26T08:00:00Z'),
  rows: [
    { userId: 'u1', email: 'layla@x.io', plan: 'Monthly', key: 'p:1', periodLabel: view === 'period' ? 'from 1 Oct 2026' : 'Oct 2026', group: '2026-10', claudeAed: 70, calls: 12, byClass: { extraction: 60, recall: 10 }, voiceSeconds: 600, voiceAed: 0.07, voiceEstimated: false, totalCostAed: 70.07, revenueAed: 299, marginAed: 228.93, marginPct: 76.57, overCeiling: true, cap: view === 'period' ? { capAed: 45, spentAed: 70, reached: true } : null },
    { userId: 'u2', email: 'omar@x.io', plan: 'Trial', key: 'p:2', periodLabel: 'from 3 Oct 2026', group: '2026-10', claudeAed: 4, calls: 2, byClass: { extraction: 4 }, voiceSeconds: null, voiceAed: null, voiceEstimated: false, totalCostAed: 4, revenueAed: 0, marginAed: -4, marginPct: null, overCeiling: false, cap: view === 'period' ? { capAed: 15, spentAed: 4, reached: false } : null },
  ],
  totals: [{ group: '2026-10', label: view === 'period' ? 'Periods starting Oct 2026' : 'Oct 2026', costAed: 74.07, revenueAed: 299, marginAed: 224.93, marginPct: 75.23 }],
});
function api(over: Partial<OpsCostsApi> = {}): OpsCostsApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: vi.fn(async (token: string, view: 'period' | 'month') => { calls.push(`get:${token}:${view}`); return report(view); }),
    downloadCsv: vi.fn(async (token: string, view: 'period' | 'month') => { calls.push(`csv:${token}:${view}`); }),
    ...over,
  };
}
async function open(a: OpsCostsApi): Promise<void> {
  render(<CostsAdmin api={a} />);
  await userEvent.type(screen.getByLabelText(/ops token/i), 'tok123');
  await userEvent.click(screen.getByRole('button', { name: /open/i }));
}
beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

describe('[P44-2] /ops/costs', () => {
  it('asks for the ops token first; nothing is fetched without it', () => {
    const a = api();
    render(<CostsAdmin api={a} />);
    expect(screen.getByLabelText(/ops token/i)).toHaveAttribute('type', 'password');
    expect(a.calls).toEqual([]);
  });

  it('billing period by default: one row per user per period with cost, revenue and margin', async () => {
    const a = api();
    await open(a);
    const row = await screen.findByTestId('cost-row-u1-p:1');
    expect(a.calls).toEqual(['get:tok123:period']);
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
    await waitFor(() => expect(a.calls).toContain('get:tok123:month'));
    expect(await screen.findByText('Oct 2026', { selector: '[data-testid="cost-row-u1-p:1"] *' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(a.calls).toContain('csv:tok123:month');
  });

  it('says what is left out, and from when voice cost is recorded', async () => {
    await open(api());
    await screen.findByTestId('cost-row-u1-p:1');
    expect(screen.getByTestId('costs-note')).toHaveTextContent('Embeddings and infrastructure (AWS, database, email) are not included.');
    expect(screen.getByTestId('costs-note')).toHaveTextContent('Voice-note cost is estimated from recorded audio seconds at the Groq rate, recorded from 26 Oct 2026.');
  });

  it('NEGATIVE: a refused token is cleared and the prompt shown again', async () => {
    await open(api({ get: vi.fn(async () => { throw new OpsUnauthorizedError(); }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/refused/i);
    expect(screen.getByLabelText(/ops token/i)).toBeInTheDocument();
  });
});
