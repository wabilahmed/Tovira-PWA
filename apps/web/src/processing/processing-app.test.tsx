import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 40_000 });

// [P65-3 · owner] In the app: the moment the rep saves a note, a toast says Tovira is reading it and the client page
// shows the status card; the Clients list row says "Reading…"; when the server says it is done, the card becomes the
// summary. The status comes from the server (GET /processing), not from the page that sent it.
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const seeding = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
const client = { id: 'c1', name: 'Anjali Mehra', phone: null, createdAt: Date.parse('2026-10-01'), leadStatus: null };
const base = { noteId: 'n1', clientId: 'c1', clientName: 'Anjali Mehra', kind: 'typed', startedAt: Date.now(), settledAt: null };
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(state: { phase: 'none' | 'working' | 'done' }): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.includes('/processing')) {
      if (state.phase === 'none') return json(200, { items: [], working: 0 });
      if (state.phase === 'working') return json(200, { items: [{ ...base, state: 'working', stage: 'waiting', etaMinutes: 1 }], working: 1 });
      return json(200, { items: [{ ...base, state: 'done', settledAt: Date.now(), found: { promises: 4, overduePromises: 1, dates: 2, requirements: 3, people: 2, needsAnswer: 2 } }], working: 0 });
    }
    if (url.includes('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, seeding);
    if (url.includes('/notes/paste') && method === 'POST') { state.phase = 'working'; return json(201, { note: { id: 'n1', status: 'pending_extraction' } }); }
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [client] });
    if (/\/clients\/[^/]+\/notes/.test(url)) return json(200, { notes: [] });
    return json(404, {});
  }));
  return { calls };
}

describe('[P65] the status in the app', () => {
  it('saving a note: the toast at once, the status card on the page, then the summary when the server says done', async () => {
    const state = { phase: 'none' as 'none' | 'working' | 'done' };
    stub(state);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Anjali Mehra'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Anjali Mehra' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '+ Add note' }));
    await user.click(screen.getByRole('button', { name: /^Type/ }));
    await user.type(screen.getByLabelText('Type a note'), 'I will send the floor plan by Friday.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByTestId('processing-toast')).toHaveTextContent('Reading your note about Anjali Mehra…');
    expect(await screen.findByText('Tovira is reading this note.')).toBeInTheDocument();
    state.phase = 'done';
    const summary = await screen.findByTestId('processing-n1', {}, { timeout: 10_000 }).then(async (el) => { await waitFor(() => expect(el).toHaveAttribute('data-state', 'done'), { timeout: 10_000 }); return el; });
    expect(summary).toHaveTextContent('Done. From this note Tovira found: 4 promises (1 overdue), 2 dates, 3 requirements, 2 people.');
    expect(within(summary).getByRole('button', { name: '2 things need your answer.' })).toBeInTheDocument();
  });

  it('the Clients list row shows "Reading…" while it is working (from the server, after a reload)', async () => {
    stub({ phase: 'working' });
    render(<App />);
    expect(await screen.findByTestId('processing-badge-c1')).toHaveTextContent('Reading…');
  });

  it('NEGATIVE: nothing processing: no badge, no card, and the status is read once, not polled', async () => {
    const { calls } = stub({ phase: 'none' });
    render(<App />);
    await screen.findByText('Anjali Mehra');
    await new Promise((r) => setTimeout(r, 5000));
    expect(screen.queryByTestId('processing-badge-c1')).toBeNull();
    expect(calls.filter((c) => c.includes('/processing')).length).toBe(1);
  });
});
