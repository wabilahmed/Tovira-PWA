import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/** [P39-6] The full "Needs your answer" screen: PageHeader "← Today", the title, the count as its subtitle. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/me')) return json(200, { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r', emailVerified: true } });
    if (url.includes('onboarding')) return json(200, { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] });
    if (url.includes('/confirmations')) return json(200, { promises: [
      { id: 'p1', clientId: 'c1', clientName: 'QA P14 Gate Client', text: 'Send ID photos', owner: 'client', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false, createdAt: 2 },
      { id: 'p2', clientId: 'c2', clientName: 'QA Ahmed Al Mansouri', text: 'Send the Arabian Ranches shortlist', owner: 'rep', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false, createdAt: 1 },
    ] });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [] });
    return json(404, {});
  }));
}

describe('[P39-6] Needs your answer', () => {
  it('PageHeader "← Today" + "Needs your answer" + "2 to answer"; each card asks its question', async () => {
    window.history.replaceState({}, '', '/?view=confirm');
    stub();
    render(<App />);
    const page = await screen.findByTestId('confirm-page');
    const header = within(page).getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Needs your answer' })).toBeInTheDocument();
    expect(await within(header).findByText('2 to answer')).toBeInTheDocument();
    expect(within(page).getByText('Did QA P14 Gate Client promise to send ID photos?')).toBeInTheDocument();
    expect(within(page).getByText('Did you promise QA Ahmed Al Mansouri the Arabian Ranches shortlist?')).toBeInTheDocument();
    expect(page.textContent).not.toMatch(/worth checking/i);
    await userEvent.click(within(header).getByRole('button', { name: 'Back to Today' }));
    expect(await screen.findByTestId('today-page')).toBeInTheDocument();
  });
});
