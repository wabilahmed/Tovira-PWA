import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P75 · owner] WhatsApp verify after approval, in a browser. The Today banner is compact (one line at 1440, two at
 * most at 390), sits at the top, keeps Today's first content above the fold, can't be dismissed, and vanishes without a
 * reload once verified. Plus the request form's WhatsApp field at 390, the first sign-in step, Settings → WhatsApp
 * before and after verifying, and Admin → Access. With SHOTS_DIR set each screen is saved there (not committed).
 */
test.use({ serviceWorkers: 'block' });

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(300);
  expect(await overflow(page), name).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/p75-${name}.png`, fullPage });
}
const REQUESTED = '+971501234567';
interface WaState { linked: boolean; awaiting: string | null }
async function stubWhatsApp(context: BrowserContext, state: WaState): Promise<void> {
  await stubApi(context);
  await context.addInitScript(() => { try { localStorage.setItem('tovira.theme', 'vault'); localStorage.setItem('tovira.signedIn', '1'); } catch { /* private mode */ } });
  const status = () => ({
    linked: state.linked ? { phone: REQUESTED, linkedAt: Date.UTC(2026, 10, 18, 9, 30) } : null,
    businessNumber: '+971500000001', requestedNumber: REQUESTED, awaitingConfirm: state.awaiting ? { phone: state.awaiting } : null,
  });
  await context.route((u) => u.pathname === '/api/whatsapp/link', (route) => {
    if (route.request().method() === 'POST') return route.fulfill(json({ ok: true, code: '482193', phone: REQUESTED, waLink: 'https://wa.me/971500000001?text=LINK%20482193', expiresAt: Date.now() + 900_000 }));
    return route.fulfill(json(status()));
  });
  await context.route((u) => u.pathname === '/api/whatsapp/link/confirm', (route) => {
    const accept = (route.request().postDataJSON() as { accept: boolean }).accept;
    if (accept && state.awaiting) state.linked = true;
    state.awaiting = null;
    return route.fulfill(json(status()));
  });
}
/** How many lines a box of text takes. */
const lines = (page: Page, sel: string) => page.locator(sel).evaluate((el) => {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  return Math.round(el.getBoundingClientRect().height / lh);
});

for (const [width, height, maxLines] of [[390, 844, 2], [1440, 900, 1]] as const) {
  test(`${width}px: the Today banner is compact, at the top, can't be dismissed, and goes once verified (no reload)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const state: WaState = { linked: false, awaiting: null };
    await stubWhatsApp(context, state);
    await page.goto('/app?view=today');
    const banner = page.getByTestId('whatsapp-banner');
    await expect(banner).toContainText('Verify your WhatsApp to send chats straight to Tovira.');
    expect(await lines(page, '[data-testid="whatsapp-banner"] .wa-banner__text'), 'text lines').toBeLessThanOrEqual(maxLines);
    const b = (await banner.boundingBox())!;
    expect(b.height, 'banner height').toBeLessThanOrEqual(maxLines === 1 ? 56 : 72);
    // it is the first thing under Today's header, and Today's first section still starts above the fold
    const section = (await page.getByRole('heading', { name: 'To do today' }).boundingBox())!;
    expect(section.y, 'Today content above the fold').toBeLessThan(height - 120);
    expect(await banner.getByRole('button').allTextContents()).toEqual(['Verify now']);
    await shot(page, `today-banner-${width}`);
    // a reload (the next visit) shows it again
    await page.reload();
    await expect(page.getByTestId('whatsapp-banner')).toBeVisible();
    // verified elsewhere (WhatsApp), the rep comes back: it goes without a reload
    state.linked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('whatsapp-banner')).toHaveCount(0);
    if (width === 1440) await shot(page, 'today-verified-1440');
  });
}

test('390px: Verify now from the banner: the number from the request, then the code and Open WhatsApp', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await stubWhatsApp(context, { linked: false, awaiting: null });
  await page.goto('/app?view=today');
  await page.getByTestId('whatsapp-banner').getByRole('button', { name: 'Verify now' }).click();
  await expect(page.getByTestId('whatsapp-verify')).toContainText('+971 50 123 4567');
  await shot(page, 'banner-sheet-390');
  await page.getByRole('button', { name: 'Get my code' }).click();
  await expect(page.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', 'https://wa.me/971500000001?text=LINK%20482193');
  await shot(page, 'banner-sheet-code-390');
});

test('390px: Settings → WhatsApp before and after verifying, and a code from a different number', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const state: WaState = { linked: false, awaiting: null };
  await stubWhatsApp(context, state);
  await page.goto('/app?view=settings');
  const sec = page.getByTestId('whatsapp-setting');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.getByTestId('whatsapp-status')).toHaveText('Not verified');
  await shot(page, 'settings-before-390');
  state.awaiting = '+447911123456';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('whatsapp-confirm')).toContainText('Your code came from +44 7911 123456, not +971 50 123 4567.');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'settings-other-number-390');
  await page.getByTestId('whatsapp-confirm').getByRole('button', { name: 'No' }).click();
  state.linked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('whatsapp-status')).toHaveText('Verified on 18 Nov 2026');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'settings-after-390');
});

test('390px: the first sign-in step (after the invite, or the invite email\'s button)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await stubWhatsApp(context, { linked: false, awaiting: null });
  await page.goto('/app?verify=whatsapp');
  const step = page.getByTestId('whatsapp-first-step');
  await expect(step.getByRole('heading', { name: 'Verify your WhatsApp' })).toBeVisible();
  await expect(step).toContainText('+971 50 123 4567');
  await shot(page, 'first-step-390');
  await step.getByRole('button', { name: 'Do it later' }).click();
  await expect(step).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('verify')).toBeNull();
  await page.goto('/app?view=today');
  await expect(page.getByTestId('whatsapp-banner')).toBeVisible(); // Do it later: the banner stays on Today until verified
});

const appHtml = (): string => readFileSync(resolve('apps/web/dist/app.html'), 'utf8');

test('390px: the request form\'s WhatsApp field (country code, then the number; nothing chosen for the rep)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.route((u) => u.pathname === '/request-access', (route) => route.request().resourceType() === 'document' ? route.fulfill({ status: 200, contentType: 'text/html', body: appHtml() }) : route.continue());
  await context.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.goto('/request-access');
  const picker = page.getByLabel('Country code');
  await expect(picker).toHaveValue('');
  await page.getByLabel('Full name').fill('Dana Rep');
  await page.getByLabel('Work email').fill('dana@example.com');
  await page.getByLabel('Phone', { exact: true }).fill('+44 7911 123456');
  await picker.scrollIntoViewIfNeeded();
  await shot(page, 'form-empty-390');
  await picker.selectOption('GB');
  await page.getByLabel('WhatsApp number').fill('07911 123456');
  const row = (await page.locator('.auth__phone').boundingBox())!;
  expect(row.width).toBeLessThanOrEqual(390 - 16 * 2 + 1);
  await shot(page, 'form-390');
});

test('1440px: Admin → Access shows each request\'s WhatsApp number and each account\'s status', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const base = { phone: '+971501234567', ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'own_clients', conversationOwnershipOther: null, expectedVolume: '50_200', industryOther: null, source: 'form', reviewedNote: null };
  const requests = [
    { ...base, id: 'r1', fullName: 'Priya Nair', workEmail: 'priya@meridian.example', companyName: 'Meridian Wealth', roleTitle: 'Relationship Manager', industry: 'wealth_private_banking', createdAt: Date.UTC(2026, 10, 18, 7), status: 'pending', reviewedAt: null, linkedUserId: null, whatsappNumber: '+919800000001', whatsapp: null },
    { ...base, id: 'r2', fullName: 'James Carter', workEmail: 'james@northgate.example', companyName: 'Northgate Insurance', roleTitle: 'Account Director', industry: 'insurance', createdAt: Date.UTC(2026, 10, 17, 9), status: 'invited', reviewedAt: Date.UTC(2026, 10, 17, 12), linkedUserId: 'u2', whatsappNumber: '+447911123456', whatsapp: { verified: false, phone: null, verifiedAt: null } },
    { ...base, id: 'r3', fullName: 'Sara Khan', workEmail: 'sara@khanrealty.example', companyName: 'Khan Realty', roleTitle: 'Broker', industry: 'property', createdAt: Date.UTC(2026, 10, 15, 9), status: 'activated', reviewedAt: Date.UTC(2026, 10, 15, 12), linkedUserId: 'u3', whatsappNumber: REQUESTED, whatsapp: { verified: true, phone: REQUESTED, verifiedAt: Date.UTC(2026, 10, 16, 8) } },
  ];
  await context.route((u) => u.pathname === '/admin/access', (route) => route.fulfill({ path: 'apps/web/dist/app.html', contentType: 'text/html' }));
  await context.route('**/api/admin/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/admin/auth/me') return route.fulfill(json({ email: 'wabil@tovira.io', stage: 'ok' }));
    if (p === '/api/admin/free-access') return route.fulfill(json({ accounts: [] }));
    if (p === '/api/admin/access-requests') return route.fulfill(json({ requests: new URL(route.request().url()).searchParams.get('status') === 'pending' ? requests.filter((r) => r.status === 'pending') : requests }));
    return route.fulfill(json({}));
  });
  await page.goto('/admin/access');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByTestId('request-r1').getByTestId('whatsapp')).toHaveText('WhatsApp: +91 98000 00001');
  await expect(page.getByTestId('request-r2').getByTestId('whatsapp-status')).toHaveText('Not verified');
  await expect(page.getByTestId('request-r3').getByTestId('whatsapp-status')).toHaveText('Verified 16 Nov 2026');
  await shot(page, 'admin-access-1440', true);
});
