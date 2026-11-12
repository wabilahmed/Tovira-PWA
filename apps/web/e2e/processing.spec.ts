import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { stubApi } from './fixtures/app-api.js';

// [P69 · owner] "Reading…" → "Analysing…" everywhere (one voice): the pinned wording below changed by owner decision.

/**
 * [P65 · owner] Showing the rep that Tovira is working, and what it found, at 390px, light and dark: the toast, the status
 * card in progress, the summary, nothing found, a failure, and the Clients list badge. [P63 · owner] Admin → Funnel too.
 * None scrolls sideways. With SHOTS_DIR set, each screen is saved as a PNG there (for review; not committed).
 */
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  expect(await overflow(page), name).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
}
type Phase = 'none' | 'working' | 'done' | 'nothing' | 'failed';
const BASE = { noteId: 'n1', clientId: 'c1', clientName: 'Sara Khan', startedAt: Date.now(), settledAt: null };
function processingBody(phase: Phase, kind: string): unknown {
  const base = { ...BASE, kind };
  if (phase === 'none') return { items: [], working: 0 };
  if (phase === 'working') return { items: [{ ...base, state: 'working', stage: kind === 'chat' ? 'reading' : 'waiting', messageCount: kind === 'chat' ? 3400 : undefined, etaMinutes: kind === 'chat' ? 2 : 1 }], working: 1 };
  if (phase === 'failed') return { items: [{ ...base, state: 'failed', failure: { reason: 'ours', canRetry: true }, settledAt: Date.now() }], working: 0 };
  const found = phase === 'done' ? { promises: 4, overduePromises: 1, dates: 2, requirements: 3, people: 2, needsAnswer: 2 } : { promises: 0, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 };
  return { items: [{ ...base, state: 'done', found, settledAt: Date.now() }], working: 0 };
}
async function stubProcessing(context: BrowserContext, state: { phase: Phase; kind: string }): Promise<void> {
  await stubApi(context);
  await context.route('**/api/processing', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(processingBody(state.phase, state.kind)) }));
  await context.route('**/api/clients/*/notes/paste', (route) => { state.phase = 'working'; state.kind = 'typed'; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ note: { id: 'n1', status: 'pending_extraction' } }) }); });
}
async function theme(page: Page, context: BrowserContext, scheme: 'light' | 'dark'): Promise<void> {
  await context.addInitScript((t) => { try { localStorage.setItem('tovira.theme', t); } catch { /* private mode */ } }, scheme === 'dark' ? 'vault' : 'ledger');
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: the toast, the card in progress, the summary, nothing found, a failure, the list badge`, async ({ page, context }) => {
    const state = { phase: 'none' as Phase, kind: 'chat' };
    await stubProcessing(context, state);
    await theme(page, context, scheme);
    await page.goto('/app');
    await page.getByRole('button', { name: 'Open Sara Khan' }).click();
    await page.getByRole('button', { name: '+ Add note' }).click();
    await page.getByRole('button', { name: /^Type/ }).click();
    await page.getByLabel('Type a note').fill('Called Sara: she wants the floor plan by Friday.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByTestId('processing-toast')).toBeVisible();
    await expect(page.getByText('Tovira is analysing this note.')).toBeVisible();
    await shot(page, `p65-1-toast-and-card-${scheme}`);

    state.kind = 'chat';
    await page.reload();
    await page.getByRole('button', { name: 'Open Sara Khan' }).click();
    await expect(page.getByText('Tovira is analysing this chat.')).toBeVisible();
    await shot(page, `p65-1b-chat-in-progress-${scheme}`);

    state.phase = 'done';
    await expect(page.getByTestId('processing-n1')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
    await shot(page, `p65-2-summary-${scheme}`);

    state.phase = 'nothing';
    await page.reload();
    await page.getByRole('button', { name: 'Open Sara Khan' }).click();
    await expect(page.getByText("Done. Tovira didn't find any promises or dates in this chat.")).toBeVisible();
    await shot(page, `p65-3-nothing-found-${scheme}`);

    state.phase = 'failed';
    await page.reload();
    await page.getByRole('button', { name: 'Open Sara Khan' }).click();
    await expect(page.getByText('Something went wrong on our side.')).toBeVisible();
    await shot(page, `p65-4-failure-${scheme}`);

    state.phase = 'working';
    await page.reload();
    await expect(page.getByTestId('processing-badge-c1')).toHaveText('Analysing…');
    await shot(page, `p65-5-list-badge-${scheme}`);
  });

  test(`390px ${scheme}: Admin → Funnel`, async ({ page, context }) => {
    await stubApi(context);
    const T = Date.now() - 2 * 86_400_000;
    await context.route('**/api/admin/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'wabil@tovira.io', stage: 'ok' }) }));
    await context.route((u) => u.pathname === '/api/admin/funnel', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      period: '30d', since: null,
      counts: { invitesSent: 12, linksOpened: 7, formsSubmitted: { invite: 3, public: 2, total: 5 }, approved: 5, passwordSet: 3, firstSignIn: 3, firstClient: 1 },
      rows: [
        { key: 'lead:1', name: 'Priya Nair', email: 'priya@brokerage.example', company: 'Harbour Homes', source: 'invite', isTest: false, inviteSentAt: T, inviteOpenedAt: T + 3600e3, submittedAt: T + 4000e3, approvedAt: T + 4000e3, passwordSetAt: T + 86_400_000, firstSignInAt: T + 86_400_000, firstClientAt: null },
        { key: 'lead:2', name: 'Omar Haddad', email: 'omar@aldar.example', company: 'Aldar', source: 'invite', isTest: false, inviteSentAt: T, inviteOpenedAt: null, submittedAt: null, approvedAt: null, passwordSetAt: null, firstSignInAt: null, firstClientAt: null },
      ],
      visits: { days: [{ day: new Date(T).toISOString().slice(0, 10), views: 41, uniques: 23 }, { day: new Date(T + 86_400_000).toISOString().slice(0, 10), views: 18, uniques: 11 }], byPage: { landing: 40, request_access: 12, sign_in: 5, privacy: 2 }, devices: { phone: 44, desktop: 15 }, topReferrers: [{ domain: 'linkedin.com', views: 21 }, { domain: 'google.com', views: 6 }], utm: [{ source: 'linkedin', campaign: 'dubai-brokers', views: 14 }], landingVisitors: 30, reachedRequest: 9, submitted: 2, reachedRequestShare: 0.3, submittedShare: 2 / 30 },
    }) }));
    // `vite preview` has no SPA fallback for /admin/* (CloudFront serves app.html in prod): serve the built app page
    await context.route((u) => u.pathname === '/admin/funnel', (route) => route.fulfill({ path: 'apps/web/dist/app.html', contentType: 'text/html' }));
    await theme(page, context, scheme);
    await page.goto('/admin/funnel');
    await expect(page.getByTestId('funnel-counts')).toBeVisible();
    await shot(page, `p63-funnel-${scheme}`);
    await page.getByTestId('funnel-visits').scrollIntoViewIfNeeded();
    await shot(page, `p63-funnel-visits-${scheme}`);
  });
}
