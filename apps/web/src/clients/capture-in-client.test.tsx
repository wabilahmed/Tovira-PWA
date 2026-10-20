import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

/**
 * [P36-3] The old `?view=capture` link lands on the Clients list (never blank, never a 404); first-run
 * onboarding goes through "New client from a chat" and still reaches the Book Scan; and every capture type
 * is on the client's own page.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const seedingStatus = (seeded: boolean) => ({ hasClient: seeded, hasNote: seeded, briefReachable: seeded, seeded, bookScanReady: seeded, nextStep: 'Export a chat.', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: ['share'], ios: ['files'] } }, fallbacks: [] });
const client = (id: string, name: string) => ({ id, name, phone: null, createdAt: Date.parse('2026-10-01'), leadStatus: null });

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(opts: { seeded: boolean; clients: ReturnType<typeof client>[] }): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, seedingStatus(opts.seeded));
    if (url.includes('/import/bulk/files')) return json(200, { ok: true });
    if (url.includes('/import/bulk/parse')) return json(200, { result: { rows: [{ fileName: 'chat.txt', platform: 'android', state: 'new', counterpart: 'Layla' }], repName: 'Wabil', needsRepId: false }, percentOfAllowance: 3 });
    if (url.includes('/status')) return json(200, { jobs: [{ key: 'chat.txt', state: 'done' }], done: true, summary: { chatsImported: 1, promises: 2, requirements: 1 }, started: { 'chat.txt': { clientId: 'c9', noteId: 'n9' } } });
    if (url.endsWith('/import/bulk') && method === 'POST') return json(202, { batchId: 'b' });
    if (url.includes('book-scan') || url.includes('bookscan')) return json(200, { isEmpty: false, message: null, invitation: 'Export your next chat.', items: [{ kind: 'unanswered_question', clientId: 'c9', clientName: 'Layla', headline: 'Layla asked something', receipt: { quote: 'Can you do bulk pricing?', date: '2026-01-16' }, framing: 'worth_checking' }] });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: opts.clients });
    if (/\/clients\/[^/]+\/notes/.test(url)) return json(200, { notes: [] });
    return json(404, {});
  }));
}

describe('[P36-3] capture lives inside a client', () => {
  it('the old ?view=capture link redirects to the Clients list', async () => {
    window.history.replaceState({}, '', '/app?view=capture');
    stub({ seeded: true, clients: [client('c1', 'Sara Khan')] });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('view')).not.toBe('capture');
    expect(screen.queryByRole('region', { name: 'Capture' })).toBeNull();
  });

  it('first-run onboarding goes through "New client from a chat" and reaches the Book Scan', { timeout: 20_000 }, async () => {
    stub({ seeded: false, clients: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }, { timeout: 5000 }));
    await user.click(await screen.findByRole('button', { name: 'Import chats' }, { timeout: 5000 }));
    const picker = await screen.findByLabelText(/choose a chat export/i, {}, { timeout: 5000 }); // the single-chat "New client from a chat"
    await user.upload(picker, new File(['13/07/2019, 1:00 am - Layla: hi'], 'chat.txt', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: /^import/i }, { timeout: 5000 }));
    await user.click(await screen.findByRole('button', { name: 'Open Book Scan' }, { timeout: 5000 }));
    expect(await screen.findByText('Layla asked something', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('every capture type is on the client page, behind its one Add button: voice note, paste a message, import a WhatsApp chat', async () => {
    stub({ seeded: true, clients: [client('c1', 'Sara Khan')] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Sara Khan'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Sara Khan' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getByRole('button', { name: /record voice note/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Paste a message' }));
    expect(screen.getByLabelText('Paste a message')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add' })); // closes
    await user.click(screen.getByRole('button', { name: '+ Add' })); // reopens the options
    await user.click(screen.getByRole('button', { name: /import a whatsapp chat/i }));
    expect(await screen.findByLabelText(/consent to import/i)).toBeInTheDocument();
  });
});
