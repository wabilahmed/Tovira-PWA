import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

/**
 * [P90-1 · owner, Prompt 88] The Clients list: "when the request fails, show an error state with a 'Try again' button,
 * not the empty state." (The 28 Nov capture showed "No clients yet." when the list failed to load and when offline.)
 */
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
const CLIENT = { id: 'c1', name: 'Meridian Corp', phone: null, createdAt: Date.now(), leadStatus: null, outcome: 'open', outcomeSource: null, outcomeChangedAt: null };
afterEach(() => vi.unstubAllGlobals());

function stub(clients: () => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/clients')) return clients();
    if (url.includes('/me/tour')) return json(200, { required: false, step: 0, steps: 10, version: 1 });
    if (url.endsWith('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('/billing/status')) return json(200, { entitled: true, status: 'trialing', trialEndsAt: Date.now() + 9 * 86_400_000, renewsAt: null, billingState: 'active' });
    return json(404, {});
  }));
}

describe('[P90-1] Clients: a failed load is an error with Try again, never "No clients yet."', () => {
  it('a server error: the alert and Try again; Try again loads the list', async () => {
    let fail = true;
    stub(() => (fail ? json(500, { error: 'internal' }) : json(200, { clients: [CLIENT] })));
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your clients.");
    expect(screen.queryByText('No clients yet.')).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Meridian Corp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('offline (the request never comes back): the same error, not the empty state', async () => {
    stub(() => { throw new TypeError('Failed to fetch'); });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your clients.");
    expect(screen.queryByText('No clients yet.')).toBeNull();
  });
  it('NEGATIVE: an account with no clients still sees "No clients yet." and no error', async () => {
    stub(() => json(200, { clients: [] }));
    render(<App />);
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
  it('NEGATIVE: a refresh that fails keeps the clients already on screen', async () => {
    let fail = false;
    stub(() => (fail ? json(503, {}) : json(200, { clients: [CLIENT] })));
    render(<App />);
    expect(await screen.findByText('Meridian Corp')).toBeInTheDocument();
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clients' }));
    await waitFor(() => expect(screen.getByText('Meridian Corp')).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load your clients.")).toBeNull();
    expect(screen.queryByText('No clients yet.')).toBeNull();
  });
});
