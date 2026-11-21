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
 *
 * [P83 · owner, 21 Nov] Pins moved by the owner's decision to messages: "Add messages" (was "Buy more usage"), packs
 * "+1,500 messages · AED 50.00" on the purchase screen, "Extra messages: 1,500 left (never expire)", the run-out line
 * "You've read your 10,000 messages this month. Resets 5 Nov." then the three packs and "Choose your own amount".
 */
const PACKS = [{ id: 'topup_50', label: '+1,500 messages', messages: 1500, priceAed: 50 }, { id: 'topup_100', label: '+3,000 messages', messages: 3000, priceAed: 100 }, { id: 'topup_150', label: '+5,000 messages', messages: 5000, priceAed: 150 }];
const CUSTOM = { min: 1000, max: 50_000, step: 500, bands: [{ from: 1000, filsPer1000: 3300 }, { from: 5000, filsPer1000: 3000 }] };
/** `pct` = messages read as a share of the month (10,000), the old percentage tests' axis. */
const at = (pct: number): Partial<AllowanceStatus> => ({ messagesUsed: pct * 100, messagesLeft: 10_000 - pct * 100, exhausted: pct >= 100, messagesExhausted: pct >= 100 });
const s = (over: Partial<AllowanceStatus> = {}): AllowanceStatus => ({
  messagesAllowance: 10_000, messagesUsed: 0, messagesTotal: 10_000, messagesLeft: 10_000, packMessagesLeft: 0, lastTopupMessages: null,
  exhausted: false, messagesExhausted: false, resetAt: '2026-11-05T00:00:00.000Z', canTopUp: true, options: PACKS, custom: CUSTOM, subscription: 'active', ...over,
});
const api = (st: AllowanceStatus | (() => AllowanceStatus)): UsageMeterApi => ({
  status: vi.fn(async () => (typeof st === 'function' ? st() : st)),
  topUp: vi.fn(async () => 'https://checkout.stripe.test/topup'),
  topUpCustom: vi.fn(async () => ({ url: 'https://checkout.stripe.test/custom' })),
});
const NOT_SUBSCRIBED: Array<Partial<AllowanceStatus>> = [
  { subscription: 'trialing' }, { subscription: 'trial_expired' }, { subscription: 'payment_failed' }, { subscription: 'past_due' }, { subscription: 'ended' }, { subscription: 'canceled' },
].map((x) => ({ ...x, canTopUp: false, options: [], custom: null }));

beforeEach(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });

describe('[P37 → P83] Settings → Subscription: Add messages', () => {
  for (const pct of [0, 50, 100]) {
    it(`an active subscriber sees "Add messages" under the bar at ${pct}%`, async () => {
      render(<UsageMeter api={api(s(at(pct)))} />);
      expect(await screen.findByRole('button', { name: 'Add messages' })).toBeInTheDocument();
    });
  }

  it('the purchase screen lists every configured pack with its price, then "Choose your own amount"', async () => {
    render(<UsageMeter api={api(s())} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add messages' }));
    const sheet = screen.getByTestId('topup-sheet');
    expect(PACKS.map((p) => within(sheet).getByTestId(`topup-${p.id}`).textContent)).toEqual([
      '+1,500 messages · AED 50.00', '+3,000 messages · AED 100.00', '+5,000 messages · AED 150.00',
    ]);
    expect(within(sheet).getByTestId('custom-pack')).toHaveTextContent('Choose your own amount');
    expect(sheet.textContent).not.toMatch(/Most popular/i);
  });

  for (const over of NOT_SUBSCRIBED) {
    for (const pct of [0, 50, 100]) {
      it(`${over.subscription} at ${pct}%: no "Add messages", no purchase screen`, async () => {
        render(<UsageMeter api={api(s({ ...over, ...at(pct) }))} onSubscribe={vi.fn()} />);
        await screen.findByTestId('usage-used');
        expect(screen.queryByRole('button', { name: 'Add messages' })).toBeNull();
        expect(screen.queryByTestId('topup-sheet')).toBeNull();
      });
    }
  }

  it('the unused pack messages: "Extra messages: 1,500 left (never expire)"', async () => {
    render(<UsageMeter api={api(s({ messagesTotal: 11_500, packMessagesLeft: 1500 }))} />);
    expect(await screen.findByTestId('usage-extra')).toHaveTextContent('Extra messages: 1,500 left (never expire)');
  });

  // [P84-5 · owner, 22 Nov] pin moved: a trial has 5,000 messages and names them
  it('a trial that runs out: "You\'ve read your 5,000 trial messages. Subscribe to keep importing." with Subscribe', async () => {
    render(<UsageMeter api={api(s({ subscription: 'trialing', trial: true, canTopUp: false, options: [], custom: null, ...at(100), messagesAllowance: 5000 }))} onSubscribe={vi.fn()} />);
    expect(await screen.findByTestId('usage-paused')).toHaveTextContent("You've read your 5,000 trial messages. Subscribe to keep importing.");
    expect(screen.getByTestId('subscribe-monthly')).toBeInTheDocument();
  });

  it('a failed payment at 100%: "Update your card" opens the billing portal', async () => {
    const onUpdateCard = vi.fn();
    render(<UsageMeter api={api(s({ subscription: 'payment_failed', canTopUp: false, options: [], custom: null, ...at(100) }))} onUpdateCard={onUpdateCard} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update your card' }));
    expect(onUpdateCard).toHaveBeenCalled();
  });

  it('back from checkout: "Updating your balance…" until the webhook has credited it', async () => {
    try { sessionStorage.setItem('tovira.topup.baseline', JSON.stringify({ total: 10_000 })); } catch { /* ignore */ }
    let credited = false;
    render(<UsageMeter api={api(() => (credited ? s({ ...at(100), exhausted: false, messagesExhausted: false, messagesTotal: 11_500, messagesLeft: 1500, packMessagesLeft: 1500, lastTopupMessages: 1500 }) : s(at(100))))} awaitingTopUp pollMs={20} />);
    expect(await screen.findByTestId('usage-updating')).toHaveTextContent('Updating your balance…');
    expect(screen.queryByTestId('usage-paused')).toBeNull(); // no stale 100% while it lands
    credited = true;
    await waitFor(() => expect(screen.queryByTestId('usage-updating')).toBeNull());
    expect(screen.getByTestId('usage-extra')).toHaveTextContent('1,500 left');
    expect(screen.getByTestId('usage-added')).toHaveTextContent('+1,500 messages added');
  });

  it('choosing a pack remembers the balance before checkout (so the return can tell when it lands)', async () => {
    const onRedirect = vi.fn();
    render(<UsageMeter api={api(s({ ...at(40), messagesTotal: 11_000, packMessagesLeft: 1000 }))} onRedirect={onRedirect} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add messages' }));
    await userEvent.click(screen.getByRole('button', { name: '+3,000 messages · AED 100.00' }));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.stripe.test/topup'));
    expect(JSON.parse(sessionStorage.getItem('tovira.topup.baseline') ?? '{}')).toEqual({ total: 11_000 });
  });
});

describe('[P37 → P83] Today warns at 80 / 95% of the messages and when they run out (month + packs together)', () => {
  it('nothing below 80%', async () => {
    const { container } = render(<UsageBanner api={api(s(at(79)))} onOpenSubscription={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
  for (const [pct, id] of [[80, 'usage-banner-80'], [95, 'usage-banner-95']] as const) {
    it(`${pct}% → "You've read ${pct * 100} of your 10,000 messages", the packs open the purchase screen`, async () => {
      const onOpen = vi.fn();
      render(<UsageBanner api={api(s(at(pct)))} onOpenSubscription={onOpen} />);
      const banner = await screen.findByTestId(id);
      expect(banner).toHaveTextContent(`You've read ${(pct * 100).toLocaleString('en-US')} of your 10,000 messages this month.`);
      await userEvent.click(within(banner).getByRole('button', { name: '+1,500 messages' }));
      expect(onOpen).toHaveBeenCalled();
    });
  }
  it('run out (subscriber): the owner line, then the three packs and "Choose your own amount", no AED', async () => {
    const onOpen = vi.fn();
    render(<UsageBanner api={api(s(at(100)))} onOpenSubscription={onOpen} />);
    const banner = await screen.findByTestId('usage-banner-100');
    expect(banner).toHaveTextContent("You've read your 10,000 messages this month. Resets 5 Nov.");
    expect(within(banner).getAllByRole('button').map((b) => b.textContent)).toEqual(['+1,500 messages', '+3,000 messages', '+5,000 messages', 'Choose your own amount']);
    expect(banner.textContent).not.toMatch(/AED|%/);
    await userEvent.click(within(banner).getByRole('button', { name: 'Choose your own amount' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('NEGATIVE: a pack keeps a rep from the 80% line (the month alone at 85%, plus 5,000 pack messages)', async () => {
    const { container } = render(<UsageBanner api={api(s({ ...at(85), messagesTotal: 15_000, messagesLeft: 6500, packMessagesLeft: 5000 }))} onOpenSubscription={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
  it('a trial that runs out sees Subscribe on Today, no packs', async () => {
    const onOpen = vi.fn();
    // [P84-5 · owner, 22 Nov] pin moved: a trial has 5,000 messages and names them
    render(<UsageBanner api={api(s({ subscription: 'trialing', trial: true, canTopUp: false, options: [], custom: null, ...at(100), messagesAllowance: 5000 }))} onOpenSubscription={onOpen} />);
    const banner = await screen.findByTestId('usage-banner-100');
    expect(banner).toHaveTextContent("You've read your 5,000 trial messages. Subscribe to keep importing.");
    expect(within(banner).queryByRole('button', { name: '+1,500 messages' })).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'Subscribe' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('a failed payment that runs out sees Update your card on Today', async () => {
    render(<UsageBanner api={api(s({ subscription: 'payment_failed', canTopUp: false, options: [], custom: null, ...at(100) }))} onOpenSubscription={vi.fn()} />);
    expect(within(await screen.findByTestId('usage-banner-100')).getByRole('button', { name: 'Update your card' })).toBeInTheDocument();
  });
});

describe('[P37 → P83] refused actions explain why and link to Subscription', () => {
  it('an import refused for the messages left shows the reason and "Add messages"', async () => {
    const { ImportChat } = await import('../import/ImportChat.js');
    const onOpen = vi.fn();
    const importApi = { importWhatsApp: vi.fn(async () => ({ ok: false as const, error: 'allowance' as const, message: 'This chat has 240 messages to read. You have 200 left this month. Add more messages to import it now.' })) };
    render(<ImportChat clientId="c1" api={importApi} onImported={vi.fn()} onOpenSubscription={onOpen} />);
    await userEvent.type(screen.getByLabelText('Pasted chat export'), '13/07/2019, 1:00 am - Sara: hi');
    await userEvent.click(screen.getByLabelText('Consent to import'));
    await userEvent.click(screen.getByRole('button', { name: 'Import chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This chat has 240 messages to read. You have 200 left this month.');
    await userEvent.click(screen.getByRole('button', { name: 'Add messages' }));
    expect(onOpen).toHaveBeenCalled();
  });

  // [P39-7 · owner] Ask is gone; "Add a note" is the client-page action that needs the allowance now.
  it('"Add a note" refused for the allowance says why and links to Subscription', async () => {
    const { AddNote } = await import('../clients/page/AddNote.js');
    const onOpen = vi.fn();
    render(<AddNote clientId="c1" clientName="Sara Khan" api={{ create: vi.fn(async () => 'paused' as const) }} onOpenSubscription={onOpen} />);
    await userEvent.type(screen.getByLabelText('Add a note'), "Sara's budget is now 2.2M");
    await userEvent.click(screen.getByRole('button', { name: 'Save the note' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/AI is paused/);
    await userEvent.click(screen.getByRole('button', { name: 'Add messages' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
