import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LOAD_FAILED, loadJson } from './load.js';
import { HeroInsights } from '../hero/HeroInsights.js';
import { PromisesTracker } from '../promises/PromisesTracker.js';
import { Meetings } from '../meetings/Meetings.js';
import { Alerts } from '../proactive/Alerts.js';
import { ConfirmChitQueue } from '../confirm/ConfirmChitQueue.js';
import { Inventory } from '../inventory/Inventory.js';
import { BookScan } from '../bookscan/BookScan.js';
import { Ledger } from '../ledger/Ledger.js';
import { MondayDigest } from '../monday/MondayDigest.js';
import { Find, FIND_BUTTONS } from '../find/Find.js';

/**
 * [P90-1 · owner, Prompt 88] "Failed loads must never look like empty accounts. Clients, Today and every list screen:
 * when the request fails, show an error state with a 'Try again' button, not the empty state." One test per screen:
 * the first read fails → an alert with Try again and NOT the screen's empty wording; Try again reads again and the
 * data shows. (The Clients list is App's own: clients-load-error.test.tsx.)
 */
afterEach(() => vi.unstubAllGlobals());
const failThen = <T,>(value: T) => { let n = 0; return vi.fn(async () => (n++ === 0 ? LOAD_FAILED : value)); };
const nullThen = <T,>(value: T) => { let n = 0; return vi.fn(async () => (n++ === 0 ? null : value)); };
async function expectErrorThenRetry(emptyWording: RegExp, loaded: RegExp | string): Promise<void> {
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load|could not be loaded|couldn’t/i);
  expect(screen.queryByText(emptyWording)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(loaded)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
}

describe('[P90-1] loadJson: what counts as a failed load', () => {
  const stub = (r: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(r));
  const pick = (b: unknown) => (b as { items: string[] }).items;
  it('a 200 is the data', async () => {
    stub(async () => new Response(JSON.stringify({ items: ['a'] }), { status: 200 }));
    expect(await loadJson('/x', pick, [])).toEqual(['a']);
  });
  it('NEGATIVE: offline, a server error, and any unexpected status are failures, never an empty list', async () => {
    stub(async () => { throw new TypeError('Failed to fetch'); });
    expect(await loadJson('/x', pick, [])).toBe(LOAD_FAILED);
    for (const status of [500, 503, 404, 401, 403, 429]) {
      stub(async () => new Response('{}', { status }));
      expect(await loadJson('/x', pick, []), String(status)).toBe(LOAD_FAILED);
    }
    stub(async () => new Response('not json', { status: 200 }));
    expect(await loadJson('/x', pick, [])).toBe(LOAD_FAILED);
  });
  it('a 402 is not a failure: the feature is paused or locked, which the screen explains itself', async () => {
    stub(async () => new Response('{}', { status: 402 }));
    expect(await loadJson('/x', pick, [])).toEqual([]);
  });
});

describe('[P90-1] a failed load shows an error with Try again, not the empty state', () => {
  it('Today', async () => {
    const api = { status: async () => null, today: async () => ({ actions: [], refreshesRemaining: null }), risk: async () => [], refreshToday: async () => null,
      todayResult: failThen({ actions: [{ kind: 'promise', text: 'Send the contract', clientName: 'Greenline Studio' }], refreshesRemaining: 1 }) };
    render(<HeroInsights api={api as never} />);
    await expectErrorThenRetry(/Nothing for today yet/, /Send the contract/);
  });
  it('Promises', async () => {
    const p = { id: 'p1', clientId: 'c1', clientName: 'Lina Park', text: 'Call Lina', owner: 'rep', dueDate: null, dueRaw: null, confidence: 'high', done: false, confirmed: true, createdAt: Date.now() };
    const api = { listOpen: async () => [], listConfirmations: async () => [], trackerResult: failThen({ promises: [p], done: [], staleThresholdDays: 90 }) };
    render(<PromisesTracker api={api as never} />);
    await expectErrorThenRetry(/No open promises/, /Call Lina/);
  });
  it('Meetings', async () => {
    const m = { id: 'm1', clientId: 'c1', clientName: 'Northwind Trading', datetime: '2099-01-05T10:00', datetimeRaw: 'Tuesday 10am', title: null, confirmed: true };
    const api = { list: async () => [], listResult: failThen([m]) };
    render(<Meetings api={api as never} clients={[{ id: 'c1', name: 'Northwind Trading' }]} onCreateClient={async () => ({ id: 'c', name: 'x' })} />);
    await expectErrorThenRetry(/No meetings scheduled/, /Meeting with Northwind Trading/);
  });
  it('Alerts', async () => {
    const n = { id: 'n1', type: 'overdue_promise', title: 'A promise to Marco Rossi is overdue', body: 'Send the signed form back', read: false, createdAt: Date.now(), clientId: null };
    const api = { listNotifications: async () => [], listCold: async () => [], runScan: async () => undefined, listNotificationsResult: failThen([n]) };
    render(<Alerts api={api as never} />);
    await expectErrorThenRetry(/No alerts|Nothing needs you|all clear/i, /A promise to Marco Rossi is overdue/);
  });
  it('Needs your answer (its own screen)', async () => {
    const q = { id: 'q1', clientId: 'c1', clientName: 'Acme Health', text: 'Send the clinic list', owner: 'client', dueDate: null, dueRaw: 'by Wednesday', confidence: 'low', done: false, confirmed: false, createdAt: Date.now() };
    const api = { listConfirmations: async () => [], confirm: async () => true, reject: async () => true, listConfirmationsResult: failThen([q]) };
    render(<ConfirmChitQueue api={api as never} standalone />);
    await expectErrorThenRetry(/Nothing to answer\./, /Did Acme Health promise to send the clinic list\?/);
  });
  it('Inventory', async () => {
    const item = { id: 'i1', title: '3 bedroom villa with garden', description: 'Corner plot', quantity: 1, status: 'active', disabledReason: null };
    const api = { list: async () => [], listResult: failThen([item]), matches: async () => ({ suggestions: [], badge: 0 }) };
    render(<Inventory api={api as never} clients={[]} onSubscribe={() => undefined} />);
    await expectErrorThenRetry(/Nothing listed yet/, /3 bedroom villa with garden/);
  });
  it('Book Scan', async () => {
    const report = { isEmpty: false, message: null, invitation: '', items: [{ kind: 'unanswered_question', clientId: 'c1', clientName: 'Sara Lee', headline: 'Sara Lee asked something', receipt: { quote: 'Can you do bulk pricing?', date: '2026-01-16' }, framing: 'worth_checking' }] };
    render(<BookScan api={{ scan: nullThen(report) } as never} />);
    await expectErrorThenRetry(/Nothing found|No findings/i, /Sara Lee asked something/);
  });
  it('The Ledger', async () => {
    const summary = { totalTouched: 0, byType: {}, aed: null, items: [], entries: [], winBacks: [] };
    render(<Ledger api={{ summary: nullThen(summary) } as never} />);
    await expectErrorThenRetry(/Nothing here yet/, 'Nothing here yet.');
  });
  it('The Monday Statement', async () => {
    const digest = { weekOf: '2026-11-23', isLight: false, promisesDue: [{ text: 'Send the contract', clientName: 'Greenline Studio', dueDate: '2026-11-28' }], coolingClients: [], unansweredQuestions: [], upcomingDates: [], surfacedNotActed: [] };
    render(<MondayDigest api={{ get: nullThen(digest) } as never} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Monday Statement could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('Find: a result', async () => {
    const result = { query: 'missed_promises', count: 1, items: [{ clientId: 'c1', clientName: 'Marco Rossi', line: 'Yours: Send the signed form back', tags: [], receipt: null }] };
    const api = { run: nullThen(result), wantingOptions: async () => null };
    const Host = (): JSX.Element => <Find api={api as never} screen={{ kind: 'result', button: FIND_BUTTONS[0]! }} onScreen={() => undefined} onOpenClient={() => undefined} onOpenClients={() => undefined} />;
    render(<Host />);
    await expectErrorThenRetry(/No missed promises/i, /Marco Rossi/);
  });
});
