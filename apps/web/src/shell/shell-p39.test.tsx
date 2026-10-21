import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P39] The app shell: no top strip ("7 months · 736 moments", the email, Log out) on any page — the email and
 * Log out live in More → Account; the bottom nav is always Clients · Today · Find · Book Scan · More; a legacy
 * ?view=ask lands on Find; Settings sub-pages have a back button.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function stub(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('corpus-stats')) return json(200, { months: 7, moments: 736 });
    if (url.includes('/billing/status')) return json(200, { entitled: true, status: 'trialing', trialEndsAt: Date.now() + 9e8 });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [{ id: 'c1', name: 'Sara Khan', phone: null, createdAt: 1, leadStatus: null }] });
    return json(404, {});
  }));
}

describe('[P39] the app shell', () => {
  it('no top strip: no "moments", no email, no Log out on the Clients page', async () => {
    stub();
    render(<App />);
    await screen.findByRole('heading', { name: 'Clients' });
    expect(document.body.textContent).not.toMatch(/moments?\b/i);
    expect(screen.queryByText(/rep@example.com/)).toBeNull();
    expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
  });

  it('More → Account shows the email and Log out', async () => {
    stub();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^more$/i }));
    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(await screen.findByTestId('account-email')).toHaveTextContent('rep@example.com');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('the nav is Clients · Today · Find · Book Scan · More, in that order', async () => {
    stub();
    render(<App />);
    await screen.findByRole('heading', { name: 'Clients' });
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect([...nav.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Clients', 'Today', 'Find', 'Book Scan', 'More']);
  });

  it('a legacy ?view=ask link lands on Find', async () => {
    window.history.replaceState({}, '', '/app?view=ask');
    stub();
    render(<App />);
    expect(await screen.findByRole('button', { name: /^find$/i })).toHaveAttribute('aria-current', 'page');
  });

  it('Settings → Subscription has "← Settings" back to Settings', async () => {
    window.history.replaceState({}, '', '/app?view=settings');
    stub();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Subscription' }));
    await user.click(await screen.findByRole('button', { name: 'Back to Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
});
