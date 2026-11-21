import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageMeter } from './UsageMeter.js';
import type { AllowanceStatus } from './allowanceClient.js';

/** [P81-3 · owner, 21 Nov] The Subscription page shows the one-time onboarding import allowance while it applies:
 *  "Import allowance: AED X left" (whole AED, rounded down by the server). Outside the first 14 days, nothing. */
const s = (over: Partial<AllowanceStatus> = {}): AllowanceStatus => ({ percentUsed: 0, exhausted: false, resetAt: '2026-11-05T00:00:00.000Z', canTopUp: false, options: [], subscription: 'trialing', extraPercentLeft: 0, ...over });
const api = (st: AllowanceStatus) => ({ status: async () => st, topUp: async () => ({ ok: true }) }) as never;

describe('[P81-3] Import allowance on the Subscription page', () => {
  it('shows "Import allowance: AED 19 left"', async () => {
    render(<UsageMeter api={api(s({ importAllowanceLeftAed: 19 }))} />);
    expect(await screen.findByTestId('usage-import')).toHaveTextContent('Import allowance: AED 19 left');
  });
  it('shows AED 0 left once it is spent (still in the first 14 days)', async () => {
    render(<UsageMeter api={api(s({ importAllowanceLeftAed: 0 }))} />);
    expect(await screen.findByTestId('usage-import')).toHaveTextContent('Import allowance: AED 0 left');
  });
  it('NEGATIVE: outside the first 14 days (null), or an older server (absent), nothing is shown', async () => {
    render(<UsageMeter api={api(s({ importAllowanceLeftAed: null }))} />);
    await screen.findByTestId('usage-percent');
    expect(screen.queryByTestId('usage-import')).toBeNull();
  });
});
