import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { BulkImport } from './BulkImport.js';
import type { BulkImportApi } from './bulkImportClient.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P39-4] "New client from a chat" is a sub-screen: PageHeader "← Clients" + the title, once (no second
 * heading); the owner's intro line; the export steps as tabs in a card; a styled file button ("Choose the chat
 * export (.zip or .txt)") that shows the chosen file's name and size — never "Choose file / No file chosen".
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/me')) return json(200, { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r', emailVerified: true } });
    if (url.includes('onboarding')) return json(200, { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] });
    if (url.includes('/clients/row-summaries')) return json(200, { rows: {} });
    if (url.includes('/clients/status-suggestions')) return json(200, { suggestions: [] });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [{ id: 'a', name: 'Alpha', phone: null, createdAt: 1, leadStatus: null }] });
    return json(404, {});
  }));
}

const INTRO = "Export the chat from WhatsApp and choose it here. You confirm who it's with before anything is read.";

describe('[P39-4] New client from a chat', () => {
  it('a PageHeader with "← Clients" and the title once; the intro; tabs in a card; a styled file button', async () => {
    stub();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '+ Add client' }));
    await user.click(await screen.findByRole('button', { name: /^New client from a chat/ }));
    const page = await screen.findByTestId('clients-action');
    expect(within(page).getAllByRole('heading', { name: 'New client from a chat' })).toHaveLength(1);
    expect(within(page).getByText(INTRO)).toBeInTheDocument();
    expect(within(page).getByRole('tablist', { name: 'Your phone' })).toBeInTheDocument();
    expect(within(page).queryByRole('button', { name: /Using an/ })).toBeNull();
    expect(within(page).getByLabelText('Choose the chat export (.zip or .txt)')).toHaveAttribute('type', 'file');
    expect(page.textContent).not.toMatch(/No file chosen/);
    await user.click(within(page).getByRole('button', { name: 'Back to Clients' }));
    expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
  });

  it('shows the chosen file\'s name and size', async () => {
    let release: () => void = () => {};
    const api = {
      uploadFile: vi.fn(() => new Promise((r) => { release = () => r({ tooLarge: false }); })),
      parse: vi.fn(), abandon: vi.fn(async () => {}), startImport: vi.fn(), status: vi.fn(),
    } as unknown as BulkImportApi;
    const user = userEvent.setup();
    render(<BulkImport api={api} single />);
    await user.upload(screen.getByLabelText('Choose the chat export (.zip or .txt)'), new File(['x'.repeat(2048)], 'WhatsApp Chat with Layla.txt', { type: 'text/plain' }));
    expect(await screen.findByTestId('file-chosen')).toHaveTextContent('WhatsApp Chat with Layla.txt · 2 KB');
    release();
  });
});
