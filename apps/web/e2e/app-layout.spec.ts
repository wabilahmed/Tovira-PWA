import { test, expect, type Page } from '@playwright/test';
import { stubApi, LONG_NAME } from './fixtures/app-api.js';

/**
 * [P46-6b] The app at 390px with REAL lengths (long promise text, long client names): no horizontal page scroll. The
 * Promises screen overflowed on the phone (481px, "Delete" cut off) while the P39 screenshot check passed, because its
 * stub had no promises. This runs the built app against a stub API with long text, in light and dark.
 */
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const overflow = (page: Page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: Promises with long text and long names never scrolls sideways`, async ({ page, context }) => {
    await stubApi(context);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/app?view=promises');
    await expect(page.getByText('Pay the deposit, contingent on mortgage approval', { exact: false }).first()).toBeVisible();
    const { scrollW, clientW } = await overflow(page);
    expect(scrollW).toBeLessThanOrEqual(clientW);
    await expect(page.getByText(LONG_NAME).first()).toBeVisible(); // every row names its client
  });
}

test('390px: the client page (phone row), Inventory and Settings never scroll sideways', async ({ page, context }) => {
  await stubApi(context);
  for (const path of ['/app?client=c1', '/app?view=inventory', '/app?view=settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { scrollW, clientW } = await overflow(page);
    expect(scrollW, path).toBeLessThanOrEqual(clientW);
  }
});

// [P46-4] The phone row on the client page: the label above a field that spans the row ("Phon / e" and "Sav / e" wrapped
// letter by letter when the field shared a row with Call and WhatsApp).
test('390px: the client phone field spans the row, Save is never squeezed', async ({ page, context }) => {
  await stubApi(context);
  await page.goto('/app?client=c1');
  const field = page.getByLabel('Phone', { exact: true });
  await expect(field).toBeVisible();
  const w = (await field.boundingBox())!.width;
  expect(w).toBeGreaterThan(300);
  const save = (await page.getByRole('button', { name: 'Save' }).boundingBox())!;
  expect(save.height).toBeLessThan(60); // one line, never "Sav / e"
});

