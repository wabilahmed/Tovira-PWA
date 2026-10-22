import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, configure } from '@testing-library/react';
import { App } from '../App.js';
import { VIEWS, VIEW_LABEL, type View } from './nav.js';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/**
 * [P39-8] Guard: every signed-in screen renders inside the page template (data-page-template) with a PageHeader,
 * whether it has data, is empty, or is locked behind a lapsed plan. (The signed-out screens — log in, invite,
 * password reset, request access — share their own centred card, auth.css, which is on the same tokens.)
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

function stub(opts: { locked?: boolean } = {}): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/me')) return json(200, { user: { id: 'u1', email: 'rep@example.com', referralCode: 'r', emailVerified: true } });
    if (url.includes('/billing/status')) return json(200, opts.locked ? { entitled: false, status: 'expired', trialEndsAt: 0 } : { entitled: true, status: 'trialing', trialEndsAt: Date.now() + 86_400_000 * 7 });
    if (url.includes('onboarding')) return json(200, { hasClient: true, hasNote: true, briefReachable: true, seeded: false, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] });
    if (url.includes('/book-scan')) return json(200, { items: [], message: 'Nothing hiding yet.', scanProgress: { done: true } });
    if (/\/clients(\?|$)/.test(url)) return json(200, { clients: [] });
    return json(404, {});
  }));
}

const SCREENS = VIEWS.filter((v): v is View => v !== 'ask'); // 'ask' is the legacy alias of 'find'

describe('[P39-8] every screen is in the page template with a PageHeader', () => {
  for (const view of SCREENS) {
    it(`${view}`, async () => {
      window.history.replaceState({}, '', `/?view=${view}`);
      stub();
      const { container } = render(<App />);
      const header = await screen.findByTestId('page-header');
      expect(header.closest('[data-page-template]')).not.toBeNull();
      expect(within(header).getByRole('heading', { level: 1 })).toBeInTheDocument();
      // no screen keeps its own old-style title next to the PageHeader
      expect(container.querySelector('.tov-screenhead h2')).toBeNull();
      void VIEW_LABEL;
    });
  }

  it('a locked screen (lapsed plan) is still in the template, under its title', async () => {
    window.history.replaceState({}, '', '/?view=bookscan');
    stub({ locked: true });
    render(<App />);
    const page = await screen.findByTestId('locked-page');
    expect(within(page).getByRole('heading', { level: 1, name: 'Book Scan' })).toBeInTheDocument();
  });
});
