import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { ClientRow } from './ClientRow.js';
import { searchClients } from './searchClients.js';

// App-level integration: the whole app renders per step, so allow for a busy machine (full-suite runs).
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P36-6] Seen: every row said "ON FILE SINCE OCT 2026" and almost every row "Unsorted". A row now reads:
 * the name (2 lines max, dir="auto"), "4BR villa · Mirdif · 3.4M" from the stored requirement, then "Last message
 * 3 days ago · 1 overdue promise". No pill without a real status. Search matches aliases; the list sorts by last
 * message by default (or Name, or Overdue promises).
 */
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 16);

describe('[P36-6] a client row', () => {
  it('name, the wants line, last message + overdue promises — no "on file since"', () => {
    render(<ul><ClientRow client={{ id: 'c1', name: 'QA Windowed Buyer 2', phone: null, createdAt: 1, leadStatus: 'warm' }} summary={{ listLine: '4BR villa · Mirdif · 3.4M', lastMessageAt: at(3), overduePromises: 1, aliases: [] }} onOpen={() => {}} onOpenStatus={() => {}} /></ul>);
    expect(screen.getByTestId('row-wants')).toHaveTextContent('4BR villa · Mirdif · 3.4M');
    expect(screen.getByTestId('row-activity')).toHaveTextContent('Last message 3 days ago · 1 overdue promise');
    expect(document.body.textContent).not.toMatch(/on file since/i);
    expect(screen.getByTestId('row-name')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Warm')).toBeInTheDocument();
  });

  it('no status → no pill (only the ⋯ menu)', () => {
    render(<ul><ClientRow client={{ id: 'c1', name: 'New Lead', phone: null, createdAt: 1, leadStatus: null }} onOpen={() => {}} onOpenStatus={() => {}} /></ul>);
    expect(screen.queryByText(/unsorted/i)).toBeNull();
    expect(screen.queryByTestId('lead-pill-c1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeInTheDocument();
  });
});

describe('[P36-6] search matches an alias', () => {
  it('"Abu Khalid" finds QA Windowed Buyer 2', () => {
    const r = searchClients([{ name: 'QA Windowed Buyer 2', aliases: ['Abu Khalid'] }, { name: 'Sara Khan', aliases: [] }], 'abu kha');
    expect(r.hits.map((h) => [h.client.name, h.field, h.value])).toEqual([['QA Windowed Buyer 2', 'alias', 'Abu Khalid']]);
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('[P36-6] the Clients list', () => {
  function stub(): void {
    const clients = [
      { id: 'a', name: 'Alpha', phone: null, createdAt: 3, leadStatus: null },
      { id: 'b', name: 'Bravo', phone: null, createdAt: 2, leadStatus: null },
      { id: 'c', name: 'Charlie', phone: null, createdAt: 1, leadStatus: null },
    ];
    const rows = {
      a: { listLine: null, lastMessageAt: at(10), overduePromises: 0, aliases: [] },
      b: { listLine: null, lastMessageAt: at(2), overduePromises: 1, aliases: [] },
      c: { listLine: null, lastMessageAt: null, overduePromises: 3, aliases: ['Chuck'] },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/me')) return json(200, { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r', emailVerified: true } });
      if (url.includes('onboarding')) return json(200, { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] });
      if (url.includes('/clients/row-summaries')) return json(200, { rows });
      if (url.includes('/clients/status-suggestions')) return json(200, { suggestions: [] });
      if (/\/clients(\?|$)/.test(url)) return json(200, { clients });
      return json(404, {});
    }));
  }
  const order = () => screen.getAllByRole('button', { name: /^Open / }).map((b) => b.getAttribute('aria-label'));

  it('sorts by last message by default; Name and Overdue promises on request', async () => {
    stub();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(order()).toEqual(['Open Bravo', 'Open Alpha', 'Open Charlie']));
    // [P39 · owner] The sort is an icon button opening a sheet (no native <select>).
    const sortBy = async (label: string): Promise<void> => {
      await user.click(screen.getByRole('button', { name: 'Sort clients' }));
      await user.click(await screen.findByRole('radio', { name: new RegExp(`^${label}`) }));
    };
    await user.click(screen.getByRole('button', { name: 'Sort clients' }));
    expect(await screen.findByRole('radio', { name: /^Last message/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await sortBy('Name');
    await waitFor(() => expect(order()).toEqual(['Open Alpha', 'Open Bravo', 'Open Charlie']));
    await sortBy('Overdue promises');
    await waitFor(() => expect(order()).toEqual(['Open Charlie', 'Open Bravo', 'Open Alpha']));
  });

  it('the search box finds a client by alias', async () => {
    stub();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Open Charlie' });
    await user.type(screen.getByRole('searchbox'), 'chuck');
    await waitFor(() => expect(order()).toEqual(['Open Charlie']));
    expect(within(screen.getByRole('button', { name: 'Open Charlie' })).getByText(/Chuck/)).toBeInTheDocument();
  });
});
