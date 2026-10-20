import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsageMeter, type UsageMeterApi } from './UsageMeter.js';
import { UsageBanner } from './UsageBanner.js';
import type { AllowanceStatus } from './allowanceClient.js';

/**
 * [P37 · 2b] Buying extra usage is findable: "Buy more usage" sits directly under the usage bar in Settings →
 * Subscription for an active subscriber (at any percentage), and nowhere for trial / expired / payment-failed /
 * ended accounts. The picker lists the configured packs as "AED 50: +50% of your monthly allowance". The
 * unspent balance shows as "Extra usage: +80% left (never expires)". Today warns at 80 / 95 / 100%. At 100% a
 * trial sees Subscribe and a failed payment sees Update your card. Back from checkout: "Updating your balance…"
 * until the webhook has credited it.
 */
const PACKS = [{ id: 'topup_50', label: '+50%', priceAed: 50 }, { id: 'topup_100', label: '+100%', priceAed: 100 }, { id: 'topup_150', label: '+150%', priceAed: 150 }];
const s = (over: Partial<AllowanceStatus> = {}): AllowanceStatus => ({ percentUsed: 0, exhausted: false, resetAt: '2026-11-05T00:00:00.000Z', canTopUp: true, options: PACKS, subscription: 'active', extraPercentLeft: 0, ...over });
const api = (st: AllowanceStatus | (() => AllowanceStatus)): UsageMeterApi => ({
  status: vi.fn(async () => (typeof st === 'function' ? st() : st)),
  topUp: vi.fn(async () => 'https://checkout.stripe.test/topup'),
});
const NOT_SUBSCRIBED: Array<Partial<AllowanceStatus>> = [
  { subscription: 'trialing' }, { subscription: 'trial_expired' }, { subscription: 'payment_failed' }, { subscription: 'past_due' }, { subscription: 'ended' }, { subscription: 'canceled' },
].map((x) => ({ ...x, canTopUp: false, options: [] }));

beforeEach(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });

describe('[P37] Settings → Subscription: Buy more usage', () => {
  for (const pct of [0, 50, 100]) {
    it(`an active subscriber sees "Buy more usage" under the bar at ${pct}%`, async () => {
      render(<UsageMeter api={api(s({ percentUsed: pct, exhausted: pct === 100 }))} />);
      expect(await screen.findByRole('button', { name: 'Buy more usage' })).toBeInTheDocument();
    });
  }

  it('the picker lists every configured pack as "AED 50: +50% of your monthly allowance"', async () => {
    render(<UsageMeter api={api(s())} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Buy more usage' }));
    const sheet = screen.getByTestId('topup-sheet');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'AED 50: +50% of your monthly allowance', 'AED 100: +100% of your monthly allowance', 'AED 150: +150% of your monthly allowance',
    ]);
    expect(sheet.textContent).not.toMatch(/Most popular/i);
  });

  for (const over of NOT_SUBSCRIBED) {
    for (const pct of [0, 50, 100]) {
      it(`${over.subscription} at ${pct}%: no "Buy more usage", no picker`, async () => {
        render(<UsageMeter api={api(s({ ...over, percentUsed: pct, exhausted: pct === 100 }))} onSubscribe={vi.fn()} />);
        await screen.findByTestId('usage-percent');
        expect(screen.queryByRole('button', { name: 'Buy more usage' })).toBeNull();
        expect(screen.queryByTestId('topup-sheet')).toBeNull();
      });
    }
  }

  it('the unspent balance: "Extra usage: +80% left (never expires)"', async () => {
    render(<UsageMeter api={api(s({ extraPercentLeft: 80 }))} />);
    expect(await screen.findByTestId('usage-extra')).toHaveTextContent('Extra usage: +80% left (never expires)');
  });

  it('a trial at 100%: "You\'ve used this trial\'s allowance. Subscribe to keep going." with Subscribe', async () => {
    render(<UsageMeter api={api(s({ subscription: 'trialing', canTopUp: false, options: [], percentUsed: 100, exhausted: true }))} onSubscribe={vi.fn()} />);
    expect(await screen.findByTestId('usage-paused')).toHaveTextContent("You've used this trial's allowance. Subscribe to keep going.");
    expect(screen.getByTestId('subscribe-monthly')).toBeInTheDocument();
  });

  it('a failed payment at 100%: "Update your card" opens the billing portal', async () => {
    const onUpdateCard = vi.fn();
    render(<UsageMeter api={api(s({ subscription: 'payment_failed', canTopUp: false, options: [], percentUsed: 100, exhausted: true }))} onUpdateCard={onUpdateCard} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update your card' }));
    expect(onUpdateCard).toHaveBeenCalled();
  });

  it('back from checkout: "Updating your balance…" until the webhook has credited it', async () => {
    try { sessionStorage.setItem('tovira.topup.baseline', JSON.stringify({ extra: 0, percent: 100 })); } catch { /* ignore */ }
    let credited = false;
    render(<UsageMeter api={api(() => (credited ? s({ extraPercentLeft: 50, percentUsed: 66 }) : s({ percentUsed: 100, exhausted: true })))} awaitingTopUp pollMs={20} />);
    expect(await screen.findByTestId('usage-updating')).toHaveTextContent('Updating your balance…');
    expect(screen.queryByTestId('usage-paused')).toBeNull(); // no stale 100% while it lands
    credited = true;
    await waitFor(() => expect(screen.queryByTestId('usage-updating')).toBeNull());
    expect(screen.getByTestId('usage-extra')).toHaveTextContent('+50% left');
  });

  it('choosing a pack remembers the balance before checkout (so the return can tell when it lands)', async () => {
    const onRedirect = vi.fn();
    render(<UsageMeter api={api(s({ extraPercentLeft: 10, percentUsed: 40 }))} onRedirect={onRedirect} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Buy more usage' }));
    await userEvent.click(screen.getByRole('button', { name: 'AED 100: +100% of your monthly allowance' }));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.stripe.test/topup'));
    expect(JSON.parse(sessionStorage.getItem('tovira.topup.baseline') ?? '{}')).toEqual({ extra: 10, percent: 40 });
  });
});

describe('[P37] Today warns at 80 / 95 / 100% (month + balance together)', () => {
  it('nothing below 80%', async () => {
    const { container } = render(<UsageBanner api={api(s({ percentUsed: 79 }))} onOpenSubscription={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
  for (const [pct, id] of [[80, 'usage-banner-80'], [95, 'usage-banner-95'], [100, 'usage-banner-100']] as const) {
    it(`${pct}% → the ${pct}% banner with "Buy more usage" (subscriber)`, async () => {
      const onOpen = vi.fn();
      render(<UsageBanner api={api(s({ percentUsed: pct, exhausted: pct === 100 }))} onOpenSubscription={onOpen} />);
      const banner = await screen.findByTestId(id);
      await userEvent.click(within(banner).getByRole('button', { name: 'Buy more usage' }));
      expect(onOpen).toHaveBeenCalled();
    });
  }
  it('a trial at 100% sees Subscribe on Today, not Buy more usage', async () => {
    const onOpen = vi.fn();
    render(<UsageBanner api={api(s({ subscription: 'trialing', canTopUp: false, options: [], percentUsed: 100, exhausted: true }))} onOpenSubscription={onOpen} />);
    const banner = await screen.findByTestId('usage-banner-100');
    expect(banner).toHaveTextContent("You've used this trial's allowance. Subscribe to keep going.");
    expect(within(banner).queryByRole('button', { name: 'Buy more usage' })).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'Subscribe' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('a failed payment at 100% sees Update your card on Today', async () => {
    render(<UsageBanner api={api(s({ subscription: 'payment_failed', canTopUp: false, options: [], percentUsed: 100, exhausted: true }))} onOpenSubscription={vi.fn()} />);
    expect(within(await screen.findByTestId('usage-banner-100')).getByRole('button', { name: 'Update your card' })).toBeInTheDocument();
  });
});

describe('[P37] over-allowance actions explain why and link to Subscription', () => {
  it('an import refused for the allowance shows the reason and "Buy more usage"', async () => {
    const { ImportChat } = await import('../import/ImportChat.js');
    const onOpen = vi.fn();
    const importApi = { importWhatsApp: vi.fn(async () => ({ ok: false as const, error: 'allowance' as const, message: "You've used this month's AI allowance, so importing is paused. Add usage, or wait for your allowance to reset, then try again." })) };
    render(<ImportChat clientId="c1" api={importApi} onImported={vi.fn()} onOpenSubscription={onOpen} />);
    await userEvent.type(screen.getByLabelText('Pasted chat export'), '13/07/2019, 1:00 am - Sara: hi');
    await userEvent.click(screen.getByLabelText('Consent to import'));
    await userEvent.click(screen.getByRole('button', { name: 'Import chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/AI allowance, so importing is paused/);
    await userEvent.click(screen.getByRole('button', { name: 'Buy more usage' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('Ask refused for the allowance says why and links to Subscription', async () => {
    const { Ask } = await import('../recall/Ask.js');
    const onOpen = vi.fn();
    render(<Ask api={{ ask: vi.fn(async () => ({ answer: '', receipts: [], paused: true, pausedReason: 'allowance_exhausted' })) }} onOpenSubscription={onOpen} />);
    await userEvent.type(screen.getByLabelText('Your question'), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/allowance/i);
    await userEvent.click(screen.getByRole('button', { name: 'Buy more usage' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
