import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsageMeter, type UsageMeterApi } from './UsageMeter.js';
import type { AllowanceStatus } from './allowanceClient.js';

const OPTIONS = [
  { id: 'topup_25', label: '+25%', priceAed: 65 },
  { id: 'topup_50', label: '+50%', priceAed: 85 },
];
function status(over: Partial<AllowanceStatus> = {}): AllowanceStatus {
  return { percentUsed: 10, exhausted: false, resetAt: '2026-11-01T00:00:00.000Z', canTopUp: true, options: OPTIONS, ...over };
}
function makeApi(s: AllowanceStatus, over: Partial<UsageMeterApi> = {}): UsageMeterApi {
  return { status: vi.fn().mockResolvedValue(s), topUp: vi.fn().mockResolvedValue('https://checkout.stripe.test/topup'), ...over };
}

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

describe('<UsageMeter>', () => {
  it('shows one bar and one percentage — nothing about dirhams or tokens of usage', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 62 }))} />);
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('62% of this month’s usage used');
    // [P18-1] the reset date sits next to the percentage (so the number has a timeframe).
    expect(screen.getByTestId('usage-percent')).toHaveTextContent(/resets .*2026/i);
    expect(screen.getByTestId('usage-bar')).toHaveAttribute('aria-valuenow', '62');
    // D3: the meter body never leaks a dirham figure or a token count as USAGE.
    const body = screen.getByTestId('usage-meter').textContent ?? '';
    expect(body).not.toMatch(/token/i);
    expect(body).not.toMatch(/AED/); // no top-up sheet while there's headroom
  });

  // [P20-1c] A real but tiny fraction of usage must read "<1%", never a distrust-inducing flat "0%".
  it('[P20-1c] shows "<1%" when some usage is below one percent (not "0%")', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 0, rawPercentUsed: 0.5 }))} />);
    const line = await screen.findByTestId('usage-percent');
    expect(line).toHaveTextContent('<1% of this month’s usage used');
    expect(line).not.toHaveTextContent('0%');
  });

  it('[P20-1c] shows one decimal place under 10%', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 3, rawPercentUsed: 3.47 }))} />);
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('3.4% of this month’s usage used');
  });

  it('[P20-1c] shows a whole number at 10% and above', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 42, rawPercentUsed: 42.9 }))} />);
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('42% of this month’s usage used');
  });

  it('[P20-1c] shows a true 0% when there is genuinely no usage', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 0, rawPercentUsed: 0 }))} />);
    expect(await screen.findByTestId('usage-percent')).toHaveTextContent('0% of this month’s usage used');
  });

  it('[AUDIT] the bar track and fill use theme tokens, not raw hex (so they adapt to dark mode)', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 100, exhausted: true }))} />);
    const bar = await screen.findByTestId('usage-bar');
    expect(bar.getAttribute('style') ?? '').toMatch(/var\(--/);        // track is a token, not #eee
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.getAttribute('style') ?? '').toMatch(/var\(--claret/); // exhausted fill is --claret, not #b00
  });

  it('shows the 80% banner (D9)', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 82 }))} />);
    expect(await screen.findByTestId('usage-warn-80')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-warn-95')).toBeNull();
  });

  it('shows the 95% banner (D9)', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 96 }))} />);
    expect(await screen.findByTestId('usage-warn-95')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-warn-80')).toBeNull(); // the stronger one supersedes
  });

  it('a dismissed 80% banner stays hidden on reload (once per month, D9)', async () => {
    const api = makeApi(status({ percentUsed: 82 }));
    const { unmount } = render(<UsageMeter api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    unmount();
    render(<UsageMeter api={api} />);
    await waitFor(() => expect(screen.getByTestId('usage-percent')).toBeInTheDocument());
    expect(screen.queryByTestId('usage-warn-80')).toBeNull();
  });

  it('at 100% shows the paused notice with the reset date + top-up options (subscribed), NOT subscribe-now', async () => {
    render(<UsageMeter api={makeApi(status({ percentUsed: 100, exhausted: true }))} />);
    const paused = await screen.findByTestId('usage-paused');
    expect(paused).toHaveTextContent(/paused until/i);
    expect(paused).toHaveTextContent(/1 NOV 2026/);
    expect(screen.getByTestId('topup-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('topup-topup_25')).toHaveTextContent('AED 65: +25% of your monthly allowance'); // [P37] pack copy
    expect(screen.queryByTestId('subscribe-annual')).toBeNull(); // a subscriber tops up, not re-subscribes
    expect(screen.queryByTestId('subscribe-monthly')).toBeNull();
  });

  // [P11-1] A trial rep at 100% must NOT be a dead end: no top-up (no card), but a clear Subscribe now.
  it('a trial rep at 100% sees Subscribe now + the allowance-reset line, and NO top-up option (D10)', async () => {
    const onSubscribe = vi.fn();
    render(<UsageMeter api={makeApi(status({ percentUsed: 100, exhausted: true, canTopUp: false, options: [] }))} onSubscribe={onSubscribe} />);
    expect(await screen.findByTestId('usage-paused')).toBeInTheDocument();
    expect(screen.queryByTestId('topup-sheet')).toBeNull();
    expect(screen.getByTestId('subscribe-annual')).toBeInTheDocument();
    expect(screen.getByTestId('subscribe-monthly')).toBeInTheDocument();
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent(/resets your AI allowance to the full AED 60/i);
    await userEvent.click(screen.getByTestId('subscribe-annual'));
    expect(onSubscribe).toHaveBeenLastCalledWith('annual');
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  it('buying a top-up redirects to the checkout url', async () => {
    const onRedirect = vi.fn();
    const api = makeApi(status({ percentUsed: 100, exhausted: true }));
    render(<UsageMeter api={api} onRedirect={onRedirect} />);
    await userEvent.click(await screen.findByTestId('topup-topup_50'));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.stripe.test/topup'));
    expect(api.topUp).toHaveBeenCalledWith('topup_50');
  });
});
