import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P90 · owner, Prompt 88, batch 1] The signed-out screens in a real browser: they fit a 390px phone with no sideways
 * scroll and 24px side padding; on a desktop the content is a centred 420px column; every control is at least 44px
 * tall; Tab moves through the controls in the order they appear; yellow is never on a button, an input or the page.
 */
const appHtml = (): string => readFileSync(resolve('apps/web/dist/app.html'), 'utf8');
async function open(context: BrowserContext, page: Page, path: string): Promise<void> {
  await context.route((u) => u.pathname === path.split('?')[0] && path !== '/app', (route) => (route.request().resourceType() === 'document' ? route.fulfill({ status: 200, contentType: 'text/html', body: appHtml() }) : route.continue()));
  await context.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/invite') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, termsVersion: '2026-11-17', privacyVersion: '2026-11-18' }) });
    return route.fulfill({ status: p === '/api/me' ? 401 : 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto(path);
  await page.locator('.auth__heading').waitFor();
}
/** Every visible control: its text, size and position (a radio or checkbox is measured by its label, the tap target). */
const controls = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.auth a, .auth button, .auth input, .auth select')]
  .filter((el) => !el.closest('[aria-hidden="true"]') && el.getBoundingClientRect().width > 1)
  .map((el) => {
    const target = (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') ? el.closest('label') : el) as HTMLElement;
    const r = target.getBoundingClientRect();
    return { what: (el.getAttribute('aria-label') || target.innerText || (el as HTMLInputElement).type || el.tagName).trim().slice(0, 40), h: Math.round(r.height), top: Math.round(r.top + scrollY), left: Math.round(r.left), inline: getComputedStyle(el).display === 'inline' || !!el.closest('.auth__alert, .auth__consent, .auth__hint'), bg: getComputedStyle(el).backgroundColor };
  }));
const YELLOW = 'rgb(255, 228, 92)';

async function fillStep1(page: Page): Promise<void> {
  await page.getByLabel('Full name').fill('Dana Rep'); await page.getByLabel('Work email').fill('dana@example.com'); await page.getByLabel('Phone', { exact: true }).fill('+44 7911 123456');
  await page.getByLabel('Country code').selectOption('GB'); await page.getByLabel('WhatsApp number').fill('07911 123456');
}
const SCREENS: Array<[string, string, (page: Page) => Promise<void>]> = [
  ['log in', '/app', async () => undefined],
  ['request access, step 1', '/request-access', async () => undefined],
  ['request access, step 2', '/request-access', async (page) => { await fillStep1(page); await page.getByRole('button', { name: 'Next' }).click(); await page.getByText('Step 2 of 3').waitFor(); }],
  ['request access, step 3', '/request-access', async (page) => {
    await fillStep1(page); await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Company name').fill('Meridian'); await page.getByLabel('Role / job title').fill('Broker');
    await page.getByText('Property', { exact: true }).click(); await page.getByText('I am employed by it', { exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).click(); await page.getByText('Step 3 of 3').waitFor();
  }],
  ['invite', '/invite?token=t', async () => undefined],
  ['set a new password', '/reset-password?token=t', async () => undefined],
];

for (const [name, path, prepare] of SCREENS) {
  test(`390px: ${name}: fits the phone, 24px side padding, every control at least 44px, no yellow fill`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(context, page, path); await prepare(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const col = await page.locator('.auth__col').evaluate((el) => ({ pl: getComputedStyle(el).paddingLeft, pr: getComputedStyle(el).paddingRight, bg: getComputedStyle(document.querySelector('.auth')!).backgroundColor }));
    expect([col.pl, col.pr]).toEqual(['24px', '24px']);
    expect(col.bg).toBe('rgb(250, 250, 250)'); // the white page itself
    expect(await page.locator('.auth__card').count()).toBe(0);
    const list = await controls(page);
    expect(list.length).toBeGreaterThan(1);
    for (const c of list) {
      if (!c.inline) expect(c.h, `${name}: "${c.what}" is ${c.h}px tall`).toBeGreaterThanOrEqual(44);
      expect(c.bg, `${name}: "${c.what}"`).not.toBe(YELLOW);
    }
    expect(await page.locator('.auth__mk').count()).toBeLessThanOrEqual(1);
  });
}

test('1440px: the content is a 420px column, centred', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(context, page, '/app');
  const box = (await page.locator('.auth__main').boundingBox())!;
  expect(Math.round(box.width)).toBe(420);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1);
});

test('Tab moves through the request form in the order it appears on screen, and the wrong-password alert is announced', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(context, page, '/request-access');
  const seen: Array<{ what: string; top: number; left: number; trap: boolean }> = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement; const r = el.getBoundingClientRect();
      return { what: (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || (el.getAttribute('aria-labelledby') ? document.getElementById(el.getAttribute('aria-labelledby')!)!.innerText : '') || el.innerText || el.tagName).trim(), top: Math.round(r.top + scrollY), left: Math.round(r.left), trap: el.name === 'hp_trap_7' };
    }));
  }
  expect(seen.map((s) => s.what)).toEqual(['Home', 'Full name', 'Work email', 'Phone', 'Country code', 'WhatsApp number']);
  for (let i = 1; i < seen.length; i++) expect(seen[i]!.top > seen[i - 1]!.top || (seen[i]!.top === seen[i - 1]!.top && seen[i]!.left > seen[i - 1]!.left), `${seen[i - 1]!.what} then ${seen[i]!.what}`).toBe(true);
  // the hidden "Do not fill this in" field is never reached by Tab
  expect(seen.some((s) => s.trap)).toBe(false);

  await page.unrouteAll();
  await context.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/login') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_credentials', message: 'Invalid email or password.' }) });
    return route.fulfill({ status: p === '/api/me' ? 401 : 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/app');
  await page.getByLabel('Email').fill('demo@example.com'); await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText("That email and password don't match. Try again, or reset your password.");
  await alert.getByRole('button', { name: 'reset your password' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot it? No problem.' })).toBeVisible();
});
