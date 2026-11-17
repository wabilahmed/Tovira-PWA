import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P74 · owner] Every page a signed-out visitor can reach is ALWAYS dark with the landing palette, whatever theme the
 * browser has saved (the owner saw Privacy and Terms in light: a saved Light choice, and the static pages honoured it).
 * Inside the signed-in app the choice is kept, Dark when never chosen, and no app screen paints anything light in Dark.
 * With SHOTS_DIR set, each public page is saved at 390 and 1440 (for review; not committed).
 */
test.use({ serviceWorkers: 'block' });

const DARK_BG = 'rgb(23, 20, 18)'; // #171412, the landing page and the Dark token --surface-base

const saveTheme = (context: BrowserContext, v: string, signedInBefore = false) =>
  context.addInitScript(([t, h]) => {
    try { localStorage.setItem('tovira.theme', t as string); if (h) localStorage.setItem('tovira.signedIn', '1'); } catch { /* private mode */ }
  }, [v, signedInBefore] as const);

// In production a CloudFront function serves app.html for the app's client-side routes (infra/terraform/marketing.tf);
// the preview server has no such fallback, so it is simulated here (as billing-return.spec.ts does).
const SPA_ROUTES = /^\/(request-access|reset-password|invite|verify-email|admin(\/.*)?|billing\/.*|no-such-page)$/;
const appHtml = (): string => readFileSync(resolve('apps/web/dist/app.html'), 'utf8');

/** Signed out: no session anywhere (the app, the admin console), every other call 404s. */
async function signedOut(context: BrowserContext): Promise<void> {
  await context.route((url) => SPA_ROUTES.test(url.pathname), (route) =>
    route.request().resourceType() === 'document' ? route.fulfill({ status: 200, contentType: 'text/html', body: appHtml() }) : route.continue());
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/visit' || path === '/api/game-event') return route.fulfill({ status: 204, body: '' });
    if (path === '/api/version') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signupEnabled: false, referralsEnabled: false }) });
    return route.fulfill({ status: path === '/api/me' || path.startsWith('/api/admin') ? 401 : 404, contentType: 'application/json', body: '{}' });
  });
}

/** Any surface (24x16px or more) painted light: a light, mostly opaque background. */
async function lightThings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const lum = (rgb: string): { l: number; a: number } | null => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(rgb);
      if (!m) return null;
      const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return { l: 0.2126 * f(+m[1]!) + 0.7152 * f(+m[2]!) + 0.0722 * f(+m[3]!), a: m[4] === undefined ? 1 : +m[4] };
    };
    const out: string[] = [];
    for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16) continue; // a surface, not a decoration (the landing's 1-3px stars)
      const bg = lum(getComputedStyle(el).backgroundColor);
      // A light fill: the accent fill (#E8643A, L 0.25) is dark enough; the landing palette's own cream fill (#F2EDE4,
      // the "Next chat" pill) is the design. Light mode's paper (#f4f1ea, #faf7ef, #ede8dc), white or any other light fill is not.
      const cs = getComputedStyle(el).backgroundColor;
      if (bg && bg.a > 0.5 && bg.l > 0.5 && !/^rgba?\(242, 237, 228(, 1)?\)$/.test(cs)) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''} ${getComputedStyle(el).backgroundColor}`);
    }
    return out;
  });
}

const PUBLIC: [string, string][] = [
  ['landing', '/'],
  ['privacy', '/privacy/'], // vite preview serves the static pages with the slash; production maps /privacy (checked live)
  ['terms', '/terms/'],
  ['request-access', '/request-access'],
  ['sign-in', '/app'],
  ['reset-password', '/reset-password?token=t'],
  ['invite', '/invite?token=t'],
  ['verify-email', '/verify-email?token=t'],
  ['admin-sign-in', '/admin'],
  ['billing-success', '/billing/success'],
  ['billing-cancel', '/billing/cancel'],
  ['not-found', '/no-such-page'],
];

for (const width of [390, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${width}px, device ${scheme}: every public page is dark even with a saved Light theme`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await saveTheme(context, 'ledger', true); // someone signed in on this browser before and chose Light
      await signedOut(context);
      for (const [name, path] of PUBLIC) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg, `${path} body`).toBe(DARK_BG);
        if (path !== '/') expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), path).toBe('vault');
        expect(await lightThings(page), path).toEqual([]);
        if (process.env.SHOTS_DIR && scheme === 'light') await page.screenshot({ path: `${process.env.SHOTS_DIR}/p74-${name}-${width}.png`, fullPage: true });
      }
    });
  }
}

test('a saved Auto on a light device: Privacy and Terms are still dark', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await saveTheme(context, 'system');
  await signedOut(context);
  for (const path of ['/privacy/', '/terms/', '/app']) {
    await page.goto(path);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(DARK_BG);
  }
});

const SCREENS = ['clients', 'today', 'week', 'find', 'promises', 'meetings', 'alerts', 'bookscan', 'ledger', 'inventory', 'getstarted', 'confirm', 'settings', 'subscription', 'account'];

for (const scheme of ['light', 'dark'] as const) {
  test(`device ${scheme}, theme Dark: every app screen uses the dark tokens, nothing painted light`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await saveTheme(context, 'vault', true);
    await stubApi(context);
    const light: string[] = [];
    for (const path of [...SCREENS.map((v) => `/app?view=${v}`), '/app?client=c1']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), path).toBe('vault');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(DARK_BG);
      for (const t of await lightThings(page)) light.push(`${path}: ${t}`);
    }
    expect(light).toEqual([]);
  });
}

test('the signed-in app keeps a saved Light (the choice is the rep\'s)', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await saveTheme(context, 'ledger', true);
  await stubApi(context);
  await page.goto('/app?view=settings');
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ledger');
});

test('a fresh browser gets Dark: the sign-in, then the app once signed in', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const out = await browser.newContext({ colorScheme: scheme, serviceWorkers: 'block' });
    await signedOut(out);
    const p1 = await out.newPage();
    await p1.goto('/app');
    await p1.waitForLoadState('networkidle');
    expect(await p1.evaluate(() => getComputedStyle(document.body).backgroundColor), `sign-in ${scheme}`).toBe(DARK_BG);
    await out.close();
    const inn = await browser.newContext({ colorScheme: scheme, serviceWorkers: 'block' });
    await stubApi(inn);
    const p2 = await inn.newPage();
    await p2.goto('/app?view=clients');
    await p2.waitForLoadState('networkidle');
    expect(await p2.evaluate(() => document.documentElement.getAttribute('data-theme')), `app ${scheme}`).toBe('vault');
    expect(await p2.evaluate(() => getComputedStyle(document.body).backgroundColor), `app ${scheme}`).toBe(DARK_BG);
    expect(await p2.evaluate(() => localStorage.getItem('tovira.theme')), 'nothing is saved for them').toBeNull();
    await inn.close();
  }
});
