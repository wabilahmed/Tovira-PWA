import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsageMeter, type UsageMeterApi } from './UsageMeter.js';
import type { AllowanceStatus } from './allowanceClient.js';

/**
 * [USAGE-ALLOWANCE → P83 · owner, 21 Nov] Settings → Subscription. Pins moved by the owner's decision from a percentage
 * to messages: "2,340 of 10,000 messages read this month · resets 5 Dec", the run-out line "You've read your 10,000
 * messages this month. Resets 5 Dec." then the three packs and "Choose your own amount". This is the purchase screen:
 * the one place (with checkout) a price appears. The custom amount is priced live as the rep types; the server sets the
 * price at checkout.
 */
const OPTIONS = [
  { id: 'topup_50', label: '+1,500 messages', messages: 1500, priceAed: 50 },
  { id: 'topup_100', label: '+3,000 messages', messages: 3000, priceAed: 100 },
  { id: 'topup_150', label: '+5,000 messages', messages: 5000, priceAed: 150 },
];
const CUSTOM = { min: 1000, max: 50_000, step: 500, bands: [{ from: 1000, filsPer1000: 3300 }, { from: 5000, filsPer1000: 3000 }] };
function status(over: Partial<AllowanceStatus> = {}): AllowanceStatus {
  return {
    messagesAllowance: 10_000, messagesUsed: 2340, messagesTotal: 10_000, messagesLeft: 7660, packMessagesLeft: 0, lastTopupMessages: null,
    exhausted: false, messagesExhausted: false, resetAt: '2026-12-05T00:00:00.000Z', canTopUp: true, options: OPTIONS, custom: CUSTOM, ...over,
  };
}
const OUT = { messagesUsed: 10_000, messagesLeft: 0, exhausted: true, messagesExhausted: true };
function makeApi(s: AllowanceStatus, over: Partial<UsageMeterApi> = {}): UsageMeterApi {
  return {
    status: vi.fn().mockResolvedValue(s),
    topUp: vi.fn().mockResolvedValue('https://checkout.stripe.test/topup'),
    topUpCustom: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/custom' }),
    ...over,
  };
}

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

describe('<UsageMeter> in messages', () => {
  it('shows messages read and the reset day; no AED, no percentage, no tokens while nothing is being bought', async () => {
    render(<UsageMeter api={makeApi(status())} />);
    expect(await screen.findByTestId('usage-used')).toHaveTextContent('2,340 of 10,000 messages read this month · resets 5 Dec');
    expect(screen.getByTestId('usage-bar')).toHaveAttribute('aria-valuenow', '2340');
    expect(screen.getByTestId('usage-bar')).toHaveAttribute('aria-valuemax', '10000');
    const body = screen.getByTestId('usage-meter').textContent ?? '';
    expect(body).not.toMatch(/AED|%|token|cost/i);
  });

  it('unused pack messages: "Extra messages: 1,500 left (never expire)"; the last pack: "+1,500 messages added"', async () => {
    render(<UsageMeter api={makeApi(status({ messagesTotal: 11_500, packMessagesLeft: 1500, lastTopupMessages: 1500 }))} />);
    expect(await screen.findByTestId('usage-extra')).toHaveTextContent('Extra messages: 1,500 left (never expire)');
    expect(screen.getByTestId('usage-added')).toHaveTextContent('+1,500 messages added');
  });

  it('[AUDIT] the bar track and fill use theme tokens (dark mode)', async () => {
    render(<UsageMeter api={makeApi(status(OUT))} />);
    const bar = await screen.findByTestId('usage-bar');
    expect(bar.getAttribute('style') ?? '').toMatch(/var\(--/);
    expect((bar.firstElementChild as HTMLElement).getAttribute('style') ?? '').toMatch(/var\(--claret/);
  });

  it('the 80% and 95% lines speak in messages, and a dismissed one stays hidden this month', async () => {
    const api = makeApi(status({ messagesUsed: 8200, messagesLeft: 1800 }));
    const { unmount } = render(<UsageMeter api={api} />);
    expect(await screen.findByTestId('usage-warn-80')).toHaveTextContent("You've read 8,200 of your 10,000 messages this month.");
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();
    render(<UsageMeter api={api} />);
    await screen.findByTestId('usage-used');
    expect(screen.queryByTestId('usage-warn-80')).toBeNull();
  });
  it('95% supersedes 80%', async () => {
    render(<UsageMeter api={makeApi(status({ messagesUsed: 9600, messagesLeft: 400 }))} />);
    expect(await screen.findByTestId('usage-warn-95')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-warn-80')).toBeNull();
  });

  it('run out: the owner line, then the three packs and "Choose your own amount" (prices on this purchase screen)', async () => {
    render(<UsageMeter api={makeApi(status(OUT))} />);
    expect(await screen.findByTestId('usage-paused')).toHaveTextContent("You've read your 10,000 messages this month. Resets 5 Dec.");
    expect(screen.getByTestId('topup-topup_50')).toHaveTextContent('+1,500 messages · AED 50.00');
    expect(screen.getByTestId('topup-topup_100')).toHaveTextContent('+3,000 messages · AED 100.00');
    expect(screen.getByTestId('topup-topup_150')).toHaveTextContent('+5,000 messages · AED 150.00');
    expect(screen.getByTestId('custom-pack')).toHaveTextContent('Choose your own amount');
    expect(screen.queryByTestId('subscribe-annual')).toBeNull();
  });

  it('a trial rep who runs out sees Subscribe, no packs (D10)', async () => {
    const onSubscribe = vi.fn();
    render(<UsageMeter api={makeApi(status({ ...OUT, canTopUp: false, options: [], custom: null, subscription: 'trialing' }))} onSubscribe={onSubscribe} />);
    expect(await screen.findByTestId('usage-paused')).toHaveTextContent("You've read this trial's messages. Subscribe to keep importing.");
    expect(screen.queryByTestId('topup-sheet')).toBeNull();
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  it('buying a fixed pack redirects to its checkout', async () => {
    const onRedirect = vi.fn();
    const api = makeApi(status(OUT));
    render(<UsageMeter api={api} onRedirect={onRedirect} />);
    await userEvent.click(await screen.findByTestId('topup-topup_100'));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.stripe.test/topup'));
    expect(api.topUp).toHaveBeenCalledWith('topup_100');
  });
});

describe('[P83] the custom amount on the purchase screen', () => {
  const open = async (api = makeApi(status(OUT)), onRedirect = vi.fn()) => {
    render(<UsageMeter api={api} onRedirect={onRedirect} />);
    const input = await screen.findByLabelText('How many messages?');
    return { api, onRedirect, input };
  };
  const type = (input: HTMLElement, v: string) => fireEvent.change(input, { target: { value: v } });

  it('the price updates live as the rep types, exact to 2 decimals', async () => {
    const { input } = await open();
    type(input, '1500');
    expect(screen.getByTestId('custom-price')).toHaveTextContent('AED 49.50');
    type(input, '2000');
    expect(screen.getByTestId('custom-price')).toHaveTextContent('AED 66.00');
    type(input, '5000');
    expect(screen.getByTestId('custom-price')).toHaveTextContent('AED 150.00');
    type(input, '50000');
    expect(screen.getByTestId('custom-price')).toHaveTextContent('AED 1,500.00');
  });

  it('NEGATIVE: out of range or off the step shows a clear error, no price, and Buy is disabled', async () => {
    const { input } = await open();
    for (const [v, msg] of [['500', 'The smallest amount is 1,000 messages.'], ['60000', 'The largest amount is 50,000 messages.'], ['4999', 'Choose a number in steps of 500 (for example 4,500 or 5,000).']]) {
      type(input, v!);
      expect(screen.getByTestId('custom-error')).toHaveTextContent(msg!);
      expect(screen.queryByTestId('custom-price')).toBeNull();
      expect(screen.getByTestId('custom-buy')).toBeDisabled();
    }
  });

  it('checkout sends ONLY the message count (the server sets the price) and redirects', async () => {
    const { api, onRedirect, input } = await open();
    type(input, '2500');
    await userEvent.click(screen.getByTestId('custom-buy'));
    expect(api.topUpCustom).toHaveBeenCalledWith(2500);
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.stripe.test/custom'));
  });

  it('NEGATIVE: a refusal from the server is shown, no redirect', async () => {
    const api = makeApi(status(OUT), { topUpCustom: vi.fn().mockResolvedValue({ error: 'The largest amount is 50,000 messages.' }) });
    const { onRedirect, input } = await open(api);
    type(input, '2500');
    await userEvent.click(screen.getByTestId('custom-buy'));
    expect(await screen.findByTestId('custom-error')).toHaveTextContent('The largest amount is 50,000 messages.');
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('a subscriber with messages left can open the purchase screen any time', async () => {
    render(<UsageMeter api={makeApi(status())} />);
    expect(screen.queryByTestId('topup-sheet')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Add messages' }));
    expect(screen.getByTestId('topup-sheet')).toBeInTheDocument();
  });
});
