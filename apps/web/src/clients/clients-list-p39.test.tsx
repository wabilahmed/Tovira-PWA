import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P39-3] The Clients list on the design system: a PageHeader "Clients" with one "+ Add client" button (a sheet:
 * New client from a chat · Import several chats · Add by name only); one row with the search box and a sort icon
 * button; the status chips (All · Warm · Cold · Done · No status, with counts); no standalone name input, no
 * native <select>; and plain empty states for no clients and no search results.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

type C = { id: string; name: string; phone: null; createdAt: number; leadStatus: 'warm' | 'cold' | 'done' | null };
function stub(clients: C[], posts: Array<{ url: string; body: unknown }> = []): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/me')) return json(200, { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r', emailVerified: true } });
    if (url.includes('onboarding')) return json(200, { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] });
    if (url.includes('/clients/row-summaries')) return json(200, { rows: {} });
    if (url.includes('/clients/status-suggestions')) return json(200, { suggestions: [] });
    if (/\/clients(\?|$)/.test(url) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string };
      posts.push({ url, body });
      return json(201, { id: 'new1', name: body.name, phone: null, createdAt: 9, leadStatus: null });
    }
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients });
    return json(404, {});
  }));
}

const SOME: C[] = [
  { id: 'a', name: 'Alpha', phone: null, createdAt: 3, leadStatus: 'warm' },
  { id: 'b', name: 'Bravo', phone: null, createdAt: 2, leadStatus: null },
];

// [P57 · owner] "+ Add client" is now "+ New client" (Type it · Record a voice note · Import a WhatsApp chat · Import several chats);
// "Add by name only" became "Type it" (a name alone still creates the client, with no note and no AI call).
describe('[P39-3] the Clients list', () => {
  it('a PageHeader "Clients" in the page template, no standalone name input and no native <select>', async () => {
    stub(SOME);
    render(<App />);
    await screen.findByRole('button', { name: 'Open Alpha' });
    const page = screen.getByTestId('clients-page');
    expect(page).toHaveAttribute('data-page-template');
    expect(within(page).getByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: '+ New client' })).toBeInTheDocument();
    expect(page.querySelector('select')).toBeNull();
    expect(screen.queryByLabelText('New client name')).toBeNull();
    expect(within(page).queryByRole('button', { name: 'New client from a chat' })).toBeNull(); // only in the sheet
    expect(within(page).getByRole('button', { name: 'Sort clients' })).toBeInTheDocument();
  });

  it('the status chips read All · Warm · Cold · Done · No status, with counts', async () => {
    stub(SOME);
    render(<App />);
    await screen.findByRole('button', { name: 'Open Alpha' });
    const chips = within(screen.getByRole('group', { name: 'Filter clients by status' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['All2', 'Warm1', 'Cold0', 'Done0', 'No status1']);
    expect(document.body.textContent).not.toMatch(/unsorted/i);
  });

  it('"Type it" with only a name creates the client from the sheet', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    stub(SOME, posts);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '+ New client' }));
    await user.click(await screen.findByRole('button', { name: /^Type it/ }));
    await user.type(await screen.findByLabelText('Name'), 'Layla Haddad');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ name: 'Layla Haddad' });
    // [P57] + New client opens the client it made (where its note is read), instead of staying on the list
    expect(await screen.findByRole('heading', { level: 1, name: 'Layla Haddad' })).toBeInTheDocument();
  });

  it('no clients → "No clients yet." with a way to add one', async () => {
    stub([]);
    render(<App />);
    const empty = await screen.findByTestId('clients-empty');
    expect(empty).toHaveTextContent('No clients yet.');
    expect(within(empty).getByRole('button', { name: '+ New client' })).toBeInTheDocument();
  });

  it('no search results → says so, with Clear search', async () => {
    stub(SOME);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Open Alpha' });
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    const empty = await screen.findByTestId('clients-empty');
    expect(empty).toHaveTextContent('No clients match “zzzz”.');
    await user.click(within(empty).getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('button', { name: 'Open Bravo' })).toBeInTheDocument();
  });
});
