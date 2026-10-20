import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

// App-level integration: the whole app renders per step, so allow for a busy machine (full-suite runs).
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P36-1] Capture lives inside a client. A chat for a client who doesn't exist yet starts from the Clients
 * list: "New client from a chat" reads the export (deterministic parse — no model), the rep confirms the
 * counterpart on the review, and only then does the import start; the rep lands on the new client's page
 * with the import running. "Import several chats" (the bulk batch) lives here too.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
const client = (id: string, name: string) => ({ id, name, phone: null, createdAt: Date.parse('2026-10-01'), leadStatus: null });

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(state: { clients: ReturnType<typeof client>[]; calls: Array<{ method: string; url: string }> }): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    state.calls.push({ method, url });
    if (url.includes('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('/import/bulk/files')) return json(200, { ok: true });
    if (url.includes('/import/bulk/parse')) return json(200, { result: { rows: [{ fileName: 'WhatsApp Chat with Layla.txt', platform: 'android', state: 'new', counterpart: 'Layla' }], repName: 'Wabil', needsRepId: false }, percentOfAllowance: 3 });
    if (url.includes('/status')) {
      state.clients = [client('c9', 'Layla'), ...state.clients.filter((c) => c.id !== 'c9')];
      return json(200, { jobs: [{ key: 'WhatsApp Chat with Layla.txt', state: 'extracting' }], done: false, started: { 'WhatsApp Chat with Layla.txt': { clientId: 'c9', noteId: 'n9' } } });
    }
    if (url.endsWith('/import/bulk') && method === 'POST') return json(202, { batchId: 'b' });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: state.clients });
    if (url.includes('/clients/c9/notes')) return json(200, { notes: [] });
    return json(404, {});
  }));
}

describe('[P36-1] the Clients list is where a new client\'s chat comes in', () => {
  it('shows "New client from a chat" and "Import several chats"', async () => {
    stub({ clients: [client('c1', 'Sara Khan')], calls: [] });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'New client from a chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import several chats' })).toBeInTheDocument();
  });

  it('"New client from a chat": no import (no model) before the rep confirms; then lands on the new client\'s page', async () => {
    const state = { clients: [client('c1', 'Sara Khan')], calls: [] as Array<{ method: string; url: string }> };
    stub(state);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New client from a chat' }));
    const picker = await screen.findByLabelText(/choose a chat export/i);
    expect(picker).not.toHaveAttribute('multiple'); // one chat → one client
    await user.upload(picker, new File(['13/07/2019, 1:00 am - Layla: hi'], 'WhatsApp Chat with Layla.txt', { type: 'text/plain' }));
    const importBtn = await screen.findByRole('button', { name: /^import/i });
    // Parsed and shown for review — nothing has been sent for import (the only step that reaches a model).
    expect(state.calls.some((c) => c.method === 'POST' && c.url.endsWith('/import/bulk'))).toBe(false);
    await user.click(importBtn);
    expect(await screen.findByRole('heading', { level: 1, name: 'Layla' })).toBeInTheDocument();
  });

  it('"Import several chats" opens the multi-file importer', async () => {
    stub({ clients: [client('c1', 'Sara Khan')], calls: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Import several chats' }));
    expect(await screen.findByLabelText(/choose chat exports/i)).toHaveAttribute('multiple');
  });
});
