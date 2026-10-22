import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { LeadStatusSheet } from './LeadStatus.js';

// App-level integration: the whole app renders per step, so allow for a busy machine (full-suite runs).
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P36-7] Seen: no visible way to mark a client warm or cold. The status is a tappable control in the client
 * header and on every list row ("⋯"); the sheet explains each status in one line; Done asks Won or Lost (the
 * existing outcome); every change has an Undo; and what Tovira infers (gone quiet, lost_inferred) is only ever a
 * suggestion — in the sheet and as a To Confirm card — never applied by itself.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
const NAME = 'QA Enter Key Client';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

type Call = { method: string; url: string; body: unknown };
function stub(calls: Call[], opts: { status?: string | null } = {}): void {
  let lead: string | null = opts.status ?? null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const client = () => ({ id: 'c1', name: NAME, phone: null, createdAt: Date.parse('2026-09-01'), leadStatus: lead, leadStatusChangedAt: null, outcome: 'open', outcomeSource: null, outcomeChangedAt: null });
    if (url.endsWith('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('/clients/status-suggestions')) return json(200, { suggestions: lead ? [] : [{ clientId: 'c1', clientName: NAME, status: 'cold', reason: 'No reply in 34 days.' }] });
    if (url.includes('/clients/c1/lead-status')) { lead = (body as { status: string | null }).status; return json(200, client()); }
    if (url.includes('/clients/c1/outcome')) return json(200, client());
    if (url.includes('/confirmations')) return json(200, { promises: [], meetings: [], moveSuggestions: [] });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [client()] });
    if (url.includes('/clients/c1/notes')) return json(200, { notes: [] });
    return json(404, {});
  }));
}
const posts = (calls: Call[], part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).map((c) => c.body);

describe('[P36-7] the status sheet', () => {
  it('every status has a one-line explanation', () => {
    render(<LeadStatusSheet client={{ id: 'c1', name: NAME, phone: null, createdAt: 1, leadStatus: null }} onPick={() => {}} onClose={() => {}} />);
    expect(within(screen.getByTestId('lead-option-warm')).getByText('Actively talking. A deal is possible.') /* [P40-4 · owner] no em-dashes in rep-facing copy */).toBeInTheDocument();
    expect(within(screen.getByTestId('lead-option-cold')).getByText('Gone quiet or lost interest')).toBeInTheDocument();
    expect(within(screen.getByTestId('lead-option-done')).getByText('Closed. You’ll say whether it was won or lost.')).toBeInTheDocument();
    expect(within(screen.getByTestId('lead-option-unsorted')).getByText('No status')).toBeInTheDocument();
  });

  it('an inferred status shows in the sheet as a suggestion only — nothing changes until the rep taps', async () => {
    const onPick = vi.fn();
    render(<LeadStatusSheet client={{ id: 'c1', name: NAME, phone: null, createdAt: 1, leadStatus: null }} suggestion={{ status: 'cold', reason: 'No reply in 34 days.' }} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByTestId('lead-suggestion')).toHaveTextContent('Tovira suggests Cold. No reply in 34 days.') /* [P40-4 · owner] */;
    expect(onPick).not.toHaveBeenCalled();
  });

  it('the header pill on the client page opens the sheet', async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: `Open ${NAME}` }));
    await user.click(await screen.findByTestId('status-button'));
    expect(await screen.findByTestId('lead-sheet')).toBeInTheDocument();
  });

  it('the list row "⋯" changes the status; Undo restores the previous one', async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<App />);
    await user.click(within((await screen.findByRole('button', { name: `Open ${NAME}` })).closest('li')!).getByRole('button', { name: 'Change status' }));
    await user.click(await screen.findByTestId('lead-option-cold'));
    await waitFor(() => expect(posts(calls, '/lead-status')).toEqual([{ status: 'cold' }]));
    const toast = await screen.findByTestId('lead-toast');
    expect(toast).toHaveTextContent(`${NAME} moved to Cold.`);
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    // [owner, 20 Oct] Undo restores the exact previous status (with its own changed-at) — and no outcome call.
    await waitFor(() => expect(posts(calls, '/lead-status')).toEqual([{ status: 'cold' }, { status: null, restoreChangedAt: null }]));
    expect(posts(calls, '/outcome')).toEqual([]);
  });

  it('Done (lost), then Undo: the original status and outcome come back exactly — never "still open" (no clock reset)', async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<App />);
    await user.click(within((await screen.findByRole('button', { name: `Open ${NAME}` })).closest('li')!).getByRole('button', { name: 'Change status' }));
    await user.click(await screen.findByTestId('lead-option-done'));
    await user.click(await screen.findByRole('button', { name: 'Lost' }));
    await waitFor(() => expect(screen.getByTestId('lead-toast')).toHaveTextContent('moved to Done (lost).'));
    await user.click(within(screen.getByTestId('lead-toast')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(posts(calls, '/outcome')).toEqual([{ outcome: 'lost' }, { outcome: 'restore', previous: { outcome: 'open', source: null, changedAt: null } }]));
    expect(posts(calls, '/lead-status')).toEqual([{ status: 'done' }, { status: null, restoreChangedAt: null }]);
    expect(posts(calls, '/outcome')).not.toContainEqual({ outcome: 'open' });
  });

  it('Done asks Won or Lost and sets the outcome', async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<App />);
    await user.click(within((await screen.findByRole('button', { name: `Open ${NAME}` })).closest('li')!).getByRole('button', { name: 'Change status' }));
    await user.click(await screen.findByTestId('lead-option-done'));
    expect(await screen.findByText('Won or lost?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lost' }));
    await waitFor(() => expect(posts(calls, '/outcome')).toEqual([{ outcome: 'lost' }]));
    expect(posts(calls, '/lead-status')).toEqual([{ status: 'done' }]);
  });

  it('To Confirm: "No reply in 34 days. Mark … as Cold?" — never applied until the rep taps Mark cold', async () => {
    window.history.replaceState({}, '', '/app?view=confirm');
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<App />);
    const card = await screen.findByTestId('status-suggestion');
    expect(card).toHaveTextContent(`No reply in 34 days. Mark ${NAME} as Cold?`);
    expect(posts(calls, '/lead-status')).toEqual([]); // inferred ≠ applied
    expect(within(card).getByRole('button', { name: 'Keep warm' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Mark cold' }));
    await waitFor(() => expect(posts(calls, '/lead-status')).toEqual([{ status: 'cold' }]));
  });
});
