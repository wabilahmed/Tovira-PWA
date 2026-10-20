import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App.js';

// App-level integration: the whole app renders per step, so allow for a busy machine (full-suite runs).
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P36-5] Phone, QA Windowed Buyer 2: everything stacked on one long page, a WhatsApp export dumped as raw
 * "[2026-05-03T10:00:00] Name: …" lines under a WHATSAPP_EXPORT label. The client page is now a fixed header +
 * six accordions with plain titles and one-line summaries; 1–3 open by default; the rep's choice saved with
 * their account; conversations read as chat bubbles, never raw lines or enum labels.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const SEEDED = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
const CLIENT = { id: 'c2', name: 'QA Windowed Buyer 2', phone: '+971 50 123 4567', createdAt: Date.parse('2026-10-01'), leadStatus: null };
const RAW = '[2026-05-03T10:00:00] Windowed Buyer: looking for a 4BR villa in Mirdif\n[2026-05-16T12:00:00] Windowed Buyer: our budget is now 3.4M';
const OVERVIEW = {
  lastMessageAt: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 16),
  openPromises: 2, overduePromises: 1,
  wants: { summary: '4BR villa · Mirdif · budget 3.4M', listLine: '4BR villa · Mirdif · 3.4M', budgets: ['3M', '3.4M'], items: [{ id: 'r1', text: '4BR villa in Mirdif', quote: 'looking for a 4BR villa in Mirdif', noteId: 'n1', statedOn: '2026-05-03' }] },
  promises: [
    { id: 'p1', noteId: 'n1', text: 'send the ID document photos', owner: 'client', dueDate: '2026-10-15', done: false, overdue: true, stale: false, sourceSpan: null, sourceMessageAt: null },
    { id: 'p2', noteId: 'n1', text: 'send the floor plans', owner: 'rep', dueDate: null, done: false, overdue: false, stale: false, sourceSpan: null, sourceMessageAt: null },
  ],
  nextMeeting: null, meetingsCount: 0,
  conversations: [{ noteId: 'n1', kind: 'whatsapp', messageCount: 187, lastAt: '2026-05-16T12:00', createdAt: Date.parse('2026-10-19T09:00:00Z') }],
  statusSuggestion: null,
};

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(opts: { saved?: Record<string, boolean>; puts?: unknown[] } = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('/me/ui-prefs')) {
      if (method === 'PUT') { opts.puts?.push(JSON.parse(String(init?.body))); return json(200, {}); }
      return json(200, { clientSections: opts.saved ?? {} });
    }
    if (url.endsWith('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, SEEDED);
    if (url.includes('/clients/c2/overview')) return json(200, OVERVIEW);
    if (url.includes('/clients/c2/notes')) return json(200, { notes: [{ id: 'n1', source: 'whatsapp_export', rawText: RAW, status: 'extracted', createdAt: Date.parse('2026-10-19T09:00:00Z'), extractionState: 'done' }] });
    if (url.includes('/clients/c2/stakeholders')) return json(200, { people: [{ name: 'Sara Agent', role: 'agent', reports_to: null, decision_role: 'influencer' }, { name: 'Omar', role: null, reports_to: null, decision_role: 'unknown' }] });
    if (url.includes('/clients/c2/pointers')) return json(200, { pointers: [{ section: 'relationship', text: 'Ask about the school run', receipts: [] }, { section: 'close', text: 'Bring the Mirdif villa plans', receipts: [] }, { section: 'close', text: 'Confirm the 3.4M ceiling', receipts: [], inferred: true }], disclosure: null });
    if (url.includes('/receipts/conversation')) return json(200, { from: 0, source: { kind: 'chat', noteId: 'n1', repKnown: true, hasMore: false, bubbles: [
      { sender: 'Windowed Buyer', side: 'other', at: '2026-05-03T10:00', text: 'looking for a 4BR villa in Mirdif', source: false },
      { sender: 'Windowed Buyer', side: 'other', at: '2026-05-16T12:00', text: 'our budget is now 3.4M', source: false },
    ] } });
    if (url.includes('/receipts/sources')) return json(200, { sources: [] });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [CLIENT] });
    return json(404, {});
  }));
}

async function openClient(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByText('QA Windowed Buyer 2'));
  await screen.findByRole('heading', { level: 1, name: 'QA Windowed Buyer 2' });
  return user;
}
const sectionButton = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });

describe('[P36-5] the client page', () => {
  it('a header: name, "Set status" (no status), the last-message line, call + WhatsApp; no "on file since" / "moment"', async () => {
    stub();
    await openClient();
    const header = screen.getByTestId('client-header');
    expect(within(header).getByTestId('status-button')).toHaveTextContent('Set status');
    expect(within(header).queryByText(/unsorted/i)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('client-line')).toHaveTextContent('Last message 3 days ago · 2 open promises'));
    expect(within(header).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+971501234567');
    expect(within(header).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/971501234567');
    expect(document.body.textContent).not.toMatch(/on file since|\bmoments?\b/i);
  });

  it('six accordions, in order, each with its title and summary', async () => {
    stub();
    await openClient();
    await waitFor(() => expect(screen.getByTestId('section-wants-summary')).toHaveTextContent('4BR villa · Mirdif · budget 3.4M'));
    const titles = screen.getAllByTestId(/^section-[a-z]+$/).map((s) => s.querySelector('.tov-acc__title')?.textContent);
    expect(titles).toEqual(['Before your next meeting', 'What they want', 'Promises', 'Meetings and viewings', 'People involved', 'Conversations']);
    expect(screen.getByTestId('section-meeting-summary')).toHaveTextContent('3 things to keep in mind');
    expect(screen.getByTestId('section-promises-summary')).toHaveTextContent('2 open · 1 overdue');
    expect(screen.getByTestId('section-meetings-summary')).toHaveTextContent('Nothing yet'); // empty → shown, not hidden
    await waitFor(() => expect(screen.getByTestId('section-people-summary')).toHaveTextContent('2 people'));
    expect(screen.getByTestId('section-conversations-summary')).toHaveTextContent('1 WhatsApp chat · 187 messages · imported 19 Oct 2026');
  });

  it('defaults: the first three open, the last three closed (real accordion buttons)', async () => {
    stub();
    await openClient();
    for (const t of ['Before your next meeting', 'What they want', 'Promises']) expect(sectionButton(t)).toHaveAttribute('aria-expanded', 'true');
    for (const t of ['Meetings and viewings', 'People involved', 'Conversations']) expect(sectionButton(t)).toHaveAttribute('aria-expanded', 'false');
  });

  it('the rep\'s choice is saved with their account, and restored in another session', async () => {
    const puts: unknown[] = [];
    stub({ puts });
    const user = await openClient();
    await user.click(sectionButton('People involved'));
    expect(sectionButton('People involved')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(puts).toContainEqual({ clientSections: { people: true } }));
  });

  it('a saved choice from another device is what the page opens with', async () => {
    stub({ saved: { promises: false, conversations: true } });
    await openClient();
    await waitFor(() => expect(sectionButton('Conversations')).toHaveAttribute('aria-expanded', 'true'));
    expect(sectionButton('Promises')).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton('What they want')).toHaveAttribute('aria-expanded', 'true'); // untouched → default
  });

  it('promises say whose they are; pointers read "Tovira\'s read" under plain headings', async () => {
    stub();
    await openClient();
    expect(await screen.findByText('QA Windowed Buyer 2 promised')).toBeInTheDocument();
    expect(screen.getByText('You promised')).toBeInTheDocument();
    expect(await screen.findByText('Building the relationship')).toBeInTheDocument();
    expect(screen.getByText('Closing the sale')).toBeInTheDocument();
    expect(screen.getByText(/Tovira's read/)).toBeInTheDocument();
  });

  it('Conversations: one collapsed entry per chat; opened, chat bubbles — never an ISO stamp or WHATSAPP_EXPORT', async () => {
    stub();
    const user = await openClient();
    await user.click(sectionButton('Conversations'));
    const entry = await screen.findByTestId('conversation');
    expect(entry).toHaveTextContent('WhatsApp chat · 16 May 2026 · 187 messages');
    await user.click(within(entry).getByRole('button', { name: /WhatsApp chat/ }));
    expect(await within(entry).findByText('our budget is now 3.4M')).toBeInTheDocument();
    expect(within(entry).getAllByTestId('bubble')).toHaveLength(2);
    const text = screen.getByTestId('section-conversations').textContent ?? '';
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/whatsapp_export/i);
    expect(document.body.textContent).not.toMatch(/whatsapp_export/i);
  });
});
