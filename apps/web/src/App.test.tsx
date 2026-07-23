import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Route fetch by URL substring; first match wins. */
function routeFetch(routes: Array<[string, () => Response]>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      for (const [pattern, make] of routes) if (url.includes(pattern)) return make();
      return json(404, {});
    }),
  );
}

const SESSION = { user: { id: 'u1', email: 'rep@example.com' } };
const NOT_SEEDED = {
  hasClient: false, hasNote: false, briefReachable: false, seeded: false, bookScanReady: false,
  nextStep: 'Export a chat.',
  seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: ['share'], ios: ['files'] } },
  fallbacks: [{ kind: 'voice_note', label: 'Record a note' }],
};
const SCAN = {
  isEmpty: false, message: null, invitation: 'Export your next chat.',
  items: [{ kind: 'unanswered_question', clientId: 'c1', clientName: 'Sara Lee', headline: 'Sara Lee asked something', receipt: { quote: 'Can you do bulk pricing?', date: '2026-01-16' }, framing: 'worth_checking' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('<App> integration', () => {
  it('shows the login screen when unauthenticated (401 from /me)', async () => {
    routeFetch([['/me', () => json(401, { error: 'unauthorized' })]]);
    render(<App />);
    expect(await screen.findByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('renders the authed shell with a Get started nav when not yet seeded', async () => {
    routeFetch([
      ['book-scan', () => json(200, SCAN)],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    render(<App />);
    expect(await screen.findByText(/rep@example.com/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('navigates to the Promises tracker and renders open promises (API integration)', async () => {
    routeFetch([
      ['/confirmations', () => json(200, { promises: [] })],
      ['/promises', () => json(200, { promises: [{ id: 'p1', clientId: 'c1', text: 'send the revised quote', owner: 'rep', dueDate: '2026-08-01', dueRaw: null, confidence: 'high', done: false, confirmed: true }] })],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /promises/i }));
    expect(await screen.findByText(/send the revised quote/i)).toBeInTheDocument();
  });

  it('navigates to Today and renders the ranked actions (API integration)', async () => {
    routeFetch([
      ['/hero/status', () => json(200, { unlocked: false, counts: { clients: 1, notes: 1 }, needed: { clients: 4, notes: 19 }, message: 'warming up' })],
      ['/hero/patterns', () => json(200, { patterns: [] })],
      ['/hero/risk', () => json(200, { atRisk: [] })],
      ['/today', () => json(200, { actions: [{ kind: 'cold', priority: 1, text: 'Nudge Meridian — quiet 3 weeks', clientId: 'c1' }] })],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /today/i }));
    expect(await screen.findByText(/nudge meridian/i)).toBeInTheDocument();
  });

  it('navigates to Alerts and renders notifications + cold list (API integration)', async () => {
    routeFetch([
      ['/notifications', () => json(200, { notifications: [{ id: 'n1', type: 'going_cold', clientId: 'c1', title: 'Meridian has gone quiet', body: 'No contact in 30 days.', read: false, createdAt: 1 }] })],
      ['/cold', () => json(200, { clients: [{ id: 'c1', name: 'Meridian', createdAt: 1, lastTouchedAt: 1 }] })],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /alerts/i }));
    expect(await screen.findByText(/meridian has gone quiet/i)).toBeInTheDocument();
  });

  it('navigates to Meetings and lists them (API integration)', async () => {
    routeFetch([
      ['/meetings', () => json(200, { meetings: [{ id: 'm1', clientId: 'c1', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: 'Kickoff', confirmed: true, createdAt: 1 }] })],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [{ id: 'c1', name: 'Acme', createdAt: 1 }] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /meetings/i }));
    expect(await screen.findByText(/kickoff with acme/i)).toBeInTheDocument();
  });

  it('navigates to Settings and renders the plan status (API integration)', async () => {
    routeFetch([
      ['/billing/status', () => json(200, { entitled: true, status: 'active', trialEndsAt: 0 })],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /settings/i }));
    expect(await screen.findByText(/you're subscribed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
  });

  it('navigates to the Book Scan and renders its findings (API integration)', async () => {
    routeFetch([
      ['book-scan', () => json(200, SCAN)],
      ['onboarding', () => json(200, NOT_SEEDED)],
      ['/me', () => json(200, SESSION)],
      ['/clients', () => json(200, { clients: [] })],
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /book scan/i }));
    expect(await screen.findByText(/asked something/i)).toBeInTheDocument();
    expect(screen.getByText(/bulk pricing/i)).toBeInTheDocument();
  });
});
