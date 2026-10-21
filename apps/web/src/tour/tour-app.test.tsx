import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

// App-level integration: the whole app renders per step, so allow for a busy machine (full-suite runs).
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P37] The required tour in the app: shown on login whenever the account hasn't completed it (fresh, invited,
 * or an existing account), resuming at the saved step; never once completed; never on /ops/*; "Take the tour
 * again" replays it writing nothing; the last step opens "New client from a chat"; and the tour itself never
 * writes clients, notes or facts.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: false, hasNote: false, briefReachable: false, seeded: true, bookScanReady: false, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
type Call = { method: string; url: string };

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(opts: { tour?: { required: boolean; step: number }; loggedIn?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  let loggedIn = opts.loggedIn ?? true;
  const tour = opts.tour ?? { required: true, step: 0 };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url.includes('/auth/invite')) return json(200, { valid: true, termsVersion: '1', privacyVersion: '1' });
    if (url.includes('/auth/accept-invite')) return json(200, { ok: true });
    if (url.includes('/auth/login')) { loggedIn = true; return json(200, SESSION); }
    if (url.includes('/me/tour')) return json(200, { ...tour, steps: 9, version: 1 });
    if (url.endsWith('/me')) return loggedIn ? json(200, SESSION) : json(401, {});
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('/billing/status')) return json(200, { entitled: true, status: 'trialing', trialEndsAt: Date.now() + 14 * 86_400_000, renewsAt: null });
    if (url.includes('/allowance/status')) return json(200, { percentUsed: 0, exhausted: false, resetAt: null, canTopUp: false, options: [], subscription: 'trialing', extraPercentLeft: 0 });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [] });
    return json(404, {});
  }));
  return calls;
}
const tourWrites = (calls: Call[]) => calls.filter((c) => c.url.includes('/me/tour') && c.method !== 'GET');
const NOT_TOUR_WRITES = /\/clients|\/notes|\/facts|\/import|\/promises|\/requirements|\/meetings/;

describe('[P37] the tour in the app', () => {
  it('a fresh account sees it right after login, at step 1', async () => {
    stub({ loggedIn: false });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/email/i), 'rep@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByTestId('tour')).toBeInTheDocument();
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 1 of 9');
  });

  it('an invited rep sees it right after setting their password (on first sign-in)', async () => {
    window.history.replaceState({}, '', '/invite?token=abc');
    stub({ loggedIn: false });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/choose a password/i), 'password123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /set password and continue/i }));
    await user.click(await screen.findByRole('button', { name: /go to tovira/i }));
    await user.type(await screen.findByLabelText(/email/i), 'rep@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByTestId('tour')).toBeInTheDocument();
  });

  it('a reload mid-tour resumes at the saved step', async () => {
    stub({ tour: { required: true, step: 4 } });
    render(<App />);
    expect(await screen.findByTestId('tour-count')).toHaveTextContent('Step 5 of 9');
  });

  it('a completed account (a second session) never sees it', async () => {
    const calls = stub({ tour: { required: false, step: 0 } });
    render(<App />);
    await screen.findByRole('heading', { name: 'Clients' });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/me/tour'))).toBe(true));
    expect(screen.queryByTestId('tour')).toBeNull();
  });

  it('/ops/* never shows it (never even asks)', async () => {
    window.history.replaceState({}, '', '/ops/access');
    const calls = stub();
    render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('tour')).toBeNull();
    expect(calls.some((c) => c.url.includes('/me/tour'))).toBe(false);
  });

  it('"Take the tour again" (More) replays it without touching the completion record', async () => {
    const calls = stub({ tour: { required: false, step: 0 } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Clients' });
    await user.click(screen.getByRole('button', { name: /^more$/i }));
    await user.click(await screen.findByRole('button', { name: 'Take the tour again' }));
    expect(await screen.findByTestId('tour')).toBeInTheDocument();
    for (let s = 1; s < 9; s += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Import your first chat' }));
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull());
    expect(tourWrites(calls)).toEqual([]);
  });

  it('the last step completes the tour and opens "New client from a chat"; the tour writes no clients, notes or facts', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('tour');
    for (let s = 1; s < 9; s += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Import your first chat' }));
    expect(await screen.findByLabelText(/choose the chat export/i /* [P39 · owner] the button reads "Choose the chat export (.zip or .txt)" */)).toBeInTheDocument(); // New client from a chat
    expect(screen.queryByTestId('tour')).toBeNull();
    expect(tourWrites(calls).map((c) => c.method)).toContain('POST'); // /me/tour/complete
    expect(calls.filter((c) => c.method !== 'GET' && NOT_TOUR_WRITES.test(c.url))).toEqual([]);
  });
});
