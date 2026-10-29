import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, configure, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

// [P49-5] Owner: the rename shows right away on the client page and in the Clients list, with no reload; Undo puts
// the old name back in both. The ⋯ menu sits in the client page header.
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r1', emailVerified: true } };
const seeded = { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] };
type C = { id: string; name: string; phone: null; createdAt: number; leadStatus: null; nameLocked?: boolean };
const mk = (id: string, name: string, extra: Partial<C> = {}): C => ({ id, name, phone: null, createdAt: Date.parse('2026-10-01'), leadStatus: null, ...extra });

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(clients: C[]): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('/me')) return json(200, SESSION);
    if (url.includes('onboarding')) return json(200, seeded);
    const rn = /\/clients\/([^/]+)\/name$/.exec(url);
    if (rn && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name: string };
      calls.push({ url, body });
      const c = clients.find((x) => x.id === rn[1])!;
      const previousName = c.name;
      c.name = body.name;
      return json(200, { client: { ...c }, previousName });
    }
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: clients.map((c) => ({ ...c })) });
    if (/\/clients\/[^/]+\/notes/.test(url)) return json(200, { notes: [] });
    return json(404, {});
  }));
  return { calls };
}

async function openClient(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(await screen.findByText(name));
  await screen.findByRole('heading', { level: 1, name });
}

describe('[P49-5] renaming from the client page', () => {
  it('the page title and the Clients list show the new name at once; Undo restores both', async () => {
    const book = [mk('c1', 'Khalid Dubai Marina'), mk('c2', 'Sara Khan')];
    const { calls } = stub(book);
    const user = userEvent.setup();
    render(<App />);
    await openClient(user, 'Khalid Dubai Marina');
    const header = screen.getByTestId('page-header');
    await user.click(within(header).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' } /* [P58-P2 · owner] was "Edit name" */));
    const field = screen.getByLabelText('Client name');
    await user.clear(field);
    await user.type(field, 'Khalid Al Mansoori');
    await user.click(within(screen.getByLabelText('Client name').closest('form')!).getByRole('button', { name: 'Save' })); // the sheet's Save (the phone field has its own)
    expect(await screen.findByRole('heading', { level: 1, name: 'Khalid Al Mansoori' })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Khalid Dubai Marina' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Khalid Al Mansoori');
    await user.click(within(screen.getByLabelText('Client name').closest('form')!).getByRole('button', { name: 'Save' })); // the sheet's Save (the phone field has its own)
    await screen.findByRole('heading', { level: 1, name: 'Khalid Al Mansoori' });
    await user.click(screen.getByRole('button', { name: /^Back to/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument());
    expect(screen.getByText('Khalid Al Mansoori')).toBeInTheDocument();
    expect(screen.queryByText('Khalid Dubai Marina')).toBeNull();
  });

  it('NEGATIVE: a client under an erasure restriction has no ⋯ menu on its page', async () => {
    stub([mk('c1', 'Khalid', { nameLocked: true }), mk('c2', 'Sara Khan')]);
    const user = userEvent.setup();
    render(<App />);
    await openClient(user, 'Khalid');
    expect(within(screen.getByTestId('page-header')).queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
