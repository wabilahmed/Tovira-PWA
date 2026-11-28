import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

/**
 * [P90-2 · owner, Prompt 88] "A suspended paying account must see the payment message, not 'trial ended'." While an
 * account is suspended (or its subscription has ended) the server refuses everything but the payment page, the data
 * export and sign-in, so every screen but Settings, Subscription and Account shows one payment panel: what happened,
 * the way to pay, and the export. Never "Your trial has ended", never an empty list.
 */
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
afterEach(() => vi.unstubAllGlobals());
function stub(billing: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/billing/status')) return json(200, billing);
    if (url.includes('/me/tour')) return json(200, { required: false, step: 0, steps: 10, version: 1 });
    if (url.endsWith('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    return json(403, { error: 'suspended' }); // what the server answers for everything else
  }));
}
const SUSPENDED = { entitled: false, status: 'past_due', trialEndsAt: 0, renewsAt: null, billingState: 'suspended', hostedInvoiceUrl: 'https://pay.stripe.test/in_1' };

describe('[P90-2] a suspended account', () => {
  it('Clients and Today show the payment panel: the message, the way to pay, the export', async () => {
    stub(SUSPENDED);
    render(<App />);
    const panel = await screen.findByTestId('payment-locked');
    expect(panel).toHaveTextContent('Your account is suspended after a failed payment.');
    expect(panel).toHaveTextContent('Update your payment details to restore access. You can still export your data.');
    expect(screen.getByRole('link', { name: 'Update payment details' })).toHaveAttribute('href', 'https://pay.stripe.test/in_1');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByTestId('payment-locked')).toBeInTheDocument();
  });
  it('NEGATIVE: never "Your trial has ended", never "No clients yet.", no Subscribe prompt, no load error', async () => {
    stub(SUSPENDED);
    const { container } = render(<App />);
    await screen.findByTestId('payment-locked');
    expect(container.textContent).not.toMatch(/trial has ended|No clients yet|Couldn't load/i);
    expect(screen.queryByTestId('subscribe-upsell')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(container.textContent).not.toMatch(/trial has ended/i);
  });
  it('"Export my data" opens Account, which stays open', async () => {
    stub(SUSPENDED);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export my data' }));
    expect(await screen.findByTestId('account')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-locked')).toBeNull();
  });
  it('without a hosted invoice link, the way to pay is the Subscription screen', async () => {
    stub({ ...SUSPENDED, hostedInvoiceUrl: null });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update payment details' }));
    expect(await screen.findByTestId('subscription')).toBeInTheDocument();
  });
  it('an ended subscription: who to contact and the export, not "trial ended"', async () => {
    stub({ entitled: false, status: 'canceled', trialEndsAt: 0, renewsAt: null, billingState: 'ended', hostedInvoiceUrl: null });
    const { container } = render(<App />);
    const panel = await screen.findByTestId('payment-locked');
    expect(panel).toHaveTextContent('Your subscription has ended.');
    expect(screen.getByRole('link', { name: 'hello@tovira.io' })).toHaveAttribute('href', 'mailto:hello@tovira.io');
    expect(container.textContent).not.toMatch(/trial has ended|No clients yet/i);
  });
  it('NEGATIVE: an account whose payment failed but is not suspended keeps its screens (only the banner)', async () => {
    stub({ entitled: true, status: 'past_due', trialEndsAt: 0, renewsAt: null, billingState: 'payment_failed', hostedInvoiceUrl: null });
    render(<App />);
    expect(await screen.findByTestId('payment-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-locked')).toBeNull();
  });
});
