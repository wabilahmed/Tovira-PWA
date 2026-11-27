import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P74 · owner] Every page a signed-out visitor can reach is ALWAYS dark with the landing palette, whatever theme the
 * browser has saved (the owner saw Privacy and Terms in light: a saved Light choice, and the static pages honoured it).
 * Inside the signed-in app the choice is kept, Dark when never chosen, and no app screen paints anything light in Dark.
 * With SHOTS_DIR set, each public page is saved at 390 and 1440 (for review; not committed).
 * [P89 · owner, Prompt 86] "Public pages are now always light, in the Marker look ... This replaces the earlier rule
 * that public pages are always dark." Every public-page pin moves from Dark (#171412, data-theme vault) to Marker
 * (#FAFAFA, data-theme marker), and "nothing painted light" becomes "nothing painted in the old dark palette". The
 * signed-in app's pins are unchanged (this prompt does not change the app's theme).
 */
test.use({ serviceWorkers: 'block' });

const DARK_BG = 'rgb(23, 20, 18)'; // #171412, the Dark token --surface-base (the signed-in app)
const MARKER_BG = 'rgb(250, 250, 250)'; // #FAFAFA, the Marker ground (every public page, P89)

const saveTheme = (context: BrowserContext, v: string, signedInBefore = false) =>
  context.addInitScript(([t, h]) => {
    try { localStorage.setItem('tovira.theme', t as string); if (h) localStorage.setItem('tovira.signedIn', '1'); } catch { /* private mode */ }
  }, [v, signedInBefore] as const);

// In production a CloudFront function serves app.html for the app's client-side routes (infra/terraform/marketing.tf);
// the preview server has no such fallback, so it is simulated here (as billing-return.spec.ts does).
const SPA_ROUTES = /^\/(request-access|reset-password|invite|verify-email|admin(\/.*)?|billing\/.*|no-such-page)$/;

/** [P89] Any surface painted in the old dark public palette (#171412 page, #1F1B18 cards, #120F0D bands, #2A2521 fills). */
async function oldDarkThings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const old = new Set(['rgb(23, 20, 18)', 'rgb(31, 27, 24)', 'rgb(18, 15, 13)', 'rgb(42, 37, 33)', 'rgb(232, 100, 58)']);
    const out: string[] = [];
    for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (old.has(bg)) out.push(`${el.tagName.toLowerCase()} ${bg}`);
    }
    return out;
  });
}
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
  ['game', '/game/'], // [P89] the game pages (the preview serves them with the slash too)
  ['game-property', '/game/property/'],
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
    test(`${width}px, device ${scheme}: every public page is Marker even with a saved Light or Dark theme`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await saveTheme(context, 'ledger', true); // someone signed in on this browser before and chose Light
      await signedOut(context);
      for (const [name, path] of PUBLIC) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg, `${path} body`).toBe(MARKER_BG);
        if (!['/', '/game/', '/game/property/'].includes(path)) expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), path).toBe('marker');
        expect(await oldDarkThings(page), path).toEqual([]);
        expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily), path).toMatch(/^Geist/);
        if (process.env.SHOTS_DIR && scheme === 'light') await page.screenshot({ path: `${process.env.SHOTS_DIR}/p89-${name}-${width}.png`, fullPage: true });
      }
    });
  }
}

test('a saved Auto on a dark device: Privacy, Terms and the sign-in are still Marker', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await saveTheme(context, 'system');
  await signedOut(context);
  for (const path of ['/privacy/', '/terms/', '/app']) {
    await page.goto(path);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(MARKER_BG);
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

test('a fresh browser: the sign-in is Marker, then the app is Dark once signed in', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const out = await browser.newContext({ colorScheme: scheme, serviceWorkers: 'block' });
    await signedOut(out);
    const p1 = await out.newPage();
    await p1.goto('/app');
    await p1.waitForLoadState('networkidle');
    expect(await p1.evaluate(() => getComputedStyle(document.body).backgroundColor), `sign-in ${scheme}`).toBe(MARKER_BG);
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
