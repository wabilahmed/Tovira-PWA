import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P67 · owner] Send chats on WhatsApp, at 390px, light and dark: Settings while linking (the code and Open WhatsApp),
 * Settings once linked, and the confirm step opened from the WhatsApp reply's link. None scrolls sideways. With
 * SHOTS_DIR set each screen is saved as a PNG there (for review; not committed). Switched off, the stub answers 404 and
 * nothing appears (every other spec runs that way).
 */
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  expect(await overflow(page), name).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: false });
}
async function theme(page: Page, context: BrowserContext, scheme: 'light' | 'dark'): Promise<void> {
  await context.addInitScript((t) => { try { localStorage.setItem('tovira.theme', t); } catch { /* private mode */ } }, scheme === 'dark' ? 'vault' : 'ledger');
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
}
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubWhatsApp(context: BrowserContext, state: { linked: boolean }): Promise<void> {
  await stubApi(context);
  await context.route((u) => u.pathname === '/api/whatsapp/link', (route) => {
    const m = route.request().method();
    if (m === 'POST') return route.fulfill(json({ ok: true, code: '482193', phone: '+971501234567', waLink: 'https://wa.me/971500000001?text=LINK%20482193', expiresAt: Date.now() + 900_000 }));
    return route.fulfill(json({ linked: state.linked ? { phone: '+971501234567', linkedAt: Date.now() } : null, businessNumber: '+971500000001' }));
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: Settings › Send chats on WhatsApp, linking then linked`, async ({ page, context }) => {
    const state = { linked: false };
    await stubWhatsApp(context, state);
    await theme(page, context, scheme);
    await page.goto('/app?view=settings');
    await page.getByTestId('whatsapp-setting').scrollIntoViewIfNeeded();
    await page.getByLabel('Your WhatsApp number').fill('+971 50 123 4567');
    await shot(page, `p67-1-settings-start-${scheme}`);
    await page.getByRole('button', { name: 'Get a code' }).click();
    await expect(page.getByTestId('whatsapp-pending')).toContainText('Your code is 482193.');
    await expect(page.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', 'https://wa.me/971500000001?text=LINK%20482193');
    await page.getByTestId('whatsapp-setting').scrollIntoViewIfNeeded();
    await shot(page, `p67-2-settings-linking-${scheme}`);
    state.linked = true; // the LINK message arrived from that number
    await expect(page.getByTestId('whatsapp-linked')).toContainText('Send any exported chat to Tovira on WhatsApp: +971 50 000 0001', { timeout: 10_000 });
    await page.getByTestId('whatsapp-setting').scrollIntoViewIfNeeded();
    await shot(page, `p67-3-settings-linked-${scheme}`);
  });

  test(`390px ${scheme}: the confirm step opened from the WhatsApp reply's link`, async ({ page, context }) => {
    await stubWhatsApp(context, { linked: true });
    await context.route((u) => u.pathname === '/api/import/bulk/parse', (route) => route.fulfill(json({
      result: { rows: [{ fileName: 'WhatsApp Chat - Anjali Mehra.zip', platform: 'ios', state: 'new', counterpart: 'Anjali Mehra' }], repName: 'Wabil', needsRepId: false },
      percentOfAllowance: 2,
    })));
    await theme(page, context, scheme);
    await page.goto('/app?import=wa-3f2c9d');
    await expect(page.getByTestId('clients-action')).toBeVisible();
    await expect(page.getByRole('button', { name: /^import/i })).toBeVisible();
    await expect(page.getByText('Anjali Mehra')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('import')).toBeNull(); // stripped from the address bar
    await shot(page, `p67-4-confirm-from-whatsapp-${scheme}`);
  });
}
